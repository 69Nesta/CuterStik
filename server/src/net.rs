//! WebSocket connection handling: handshake, then shuttle inputs to the
//! room and snapshots back to the socket.

use std::time::Duration;

use axum::{
    body::Bytes,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt, stream::SplitStream};
use shared::{
    constants::{MAX_NAME_LEN, MAX_ROOM_NAME_LEN},
    protocol::{self, ClientMsg, InputCmd, PROTOCOL_VERSION, RoomRequest, ServerMsg, Team},
};
use tokio::sync::mpsc;

use crate::{AppState, room::RoomCmd, rooms::Joined};

struct Hello {
    name: String,
    room: RoomRequest,
    team: Option<Team>,
}

const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
/// Outgoing frames buffered per client before snapshots start being dropped.
const OUT_BUFFER: usize = 64;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.max_message_size(1024)
        .on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();

    let hello = match tokio::time::timeout(HELLO_TIMEOUT, read_hello(&mut stream)).await {
        Ok(Ok(hello)) => hello,
        Ok(Err(reason)) => {
            let msg = protocol::encode(&ServerMsg::Rejected { reason });
            let _ = sink.send(Message::Binary(msg.into())).await;
            return;
        }
        Err(_) => return,
    };

    let (out_tx, mut out_rx) = mpsc::channel::<Bytes>(OUT_BUFFER);
    let joined = state
        .rooms
        .join(hello.name, hello.room, hello.team, out_tx)
        .await;
    let Joined { id, room } = match joined {
        Ok(j) => j,
        Err(reason) => {
            let msg = protocol::encode(&ServerMsg::Rejected { reason });
            let _ = sink.send(Message::Binary(msg.into())).await;
            return;
        }
    };

    let writer = tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            if sink.send(Message::Binary(frame)).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Binary(bytes) => {
                let cmd = match protocol::decode::<ClientMsg>(&bytes) {
                    Ok(ClientMsg::Input(cmd)) => match sanitize_input(cmd) {
                        Some(cmd) => RoomCmd::Input { id, cmd },
                        None => continue,
                    },
                    Ok(ClientMsg::Buy(item)) => RoomCmd::Buy { id, item },
                    _ => continue,
                };
                // Drop the message if the room is backed up; stop if it's gone.
                if let Err(mpsc::error::TrySendError::Closed(_)) = room.try_send(cmd) {
                    break;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    let _ = room.send(RoomCmd::Leave { id }).await;
    writer.abort();
}

async fn read_hello(stream: &mut SplitStream<WebSocket>) -> Result<Hello, String> {
    while let Some(Ok(msg)) = stream.next().await {
        let Message::Binary(bytes) = msg else {
            continue;
        };
        return match protocol::decode::<ClientMsg>(&bytes) {
            Ok(ClientMsg::Hello {
                version,
                name,
                room,
                team,
            }) if version == PROTOCOL_VERSION => Ok(Hello {
                name: sanitize(&name, MAX_NAME_LEN),
                room: match room {
                    RoomRequest::Create { name, mode } => RoomRequest::Create {
                        name: sanitize(&name, MAX_ROOM_NAME_LEN),
                        mode,
                    },
                    other => other,
                },
                team,
            }),
            Ok(ClientMsg::Hello { version, .. }) => Err(format!(
                "protocol mismatch: client {version}, server {PROTOCOL_VERSION}"
            )),
            _ => Err("expected Hello".into()),
        };
    }
    Err("connection closed".into())
}

fn sanitize(raw: &str, max_len: usize) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max_len)
        .collect()
}

fn sanitize_input(mut cmd: InputCmd) -> Option<InputCmd> {
    if !cmd.yaw.is_finite() || !cmd.pitch.is_finite() {
        return None;
    }
    cmd.forward = cmd.forward.clamp(-1, 1);
    cmd.right = cmd.right.clamp(-1, 1);
    cmd.pitch = cmd.pitch.clamp(-1.55, 1.55);
    cmd.yaw = cmd.yaw.rem_euclid(std::f32::consts::TAU);
    Some(cmd)
}
