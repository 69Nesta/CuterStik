//! Room directory: quick-play matchmaking, named rooms created on demand,
//! and the public room list served to the lobby. Each room runs as its own
//! task and publishes its status through a `watch` channel.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU32, Ordering},
};

use axum::{Json, body::Bytes, extract::State};
use serde::Serialize;
use shared::{
    constants::{MAX_PLAYERS_PER_ROOM, MAX_ROOMS},
    protocol::{GameMode, PlayerId, RoomId, RoomRequest, Team},
};
use tokio::sync::{mpsc, oneshot, watch};

use crate::{
    AppState,
    room::{Room, RoomCmd, RoomStatus},
};

const ROOM_INBOX: usize = 1024;

struct RoomHandle {
    id: RoomId,
    name: Arc<str>,
    mode: GameMode,
    tx: mpsc::Sender<RoomCmd>,
    status: watch::Receiver<RoomStatus>,
}

impl RoomHandle {
    fn has_space(&self) -> bool {
        self.status.borrow().players < MAX_PLAYERS_PER_ROOM
    }
}

pub struct Joined {
    pub id: PlayerId,
    pub room: mpsc::Sender<RoomCmd>,
}

#[derive(Clone, Default)]
pub struct RoomManager {
    rooms: Arc<Mutex<Vec<RoomHandle>>>,
    next_room_id: Arc<AtomicU32>,
}

impl RoomManager {
    pub async fn join(
        &self,
        name: String,
        request: RoomRequest,
        team: Option<Team>,
        out: mpsc::Sender<Bytes>,
    ) -> Result<Joined, String> {
        // A quick-play room can fill up or shut down between picking it and
        // joining; retry a few times in that case.
        let attempts = if matches!(request, RoomRequest::Quick { .. }) { 3 } else { 1 };
        for _ in 0..attempts {
            let tx = self.pick_room(&request)?;
            let (reply_tx, reply_rx) = oneshot::channel();
            let cmd = RoomCmd::Join {
                name: name.clone(),
                team,
                out: out.clone(),
                reply: reply_tx,
            };
            if tx.send(cmd).await.is_err() {
                continue;
            }
            if let Ok(Some(id)) = reply_rx.await {
                return Ok(Joined { id, room: tx });
            }
        }
        Err(match request {
            RoomRequest::Join(_) => "That room is full".into(),
            _ => "No room available, try again".into(),
        })
    }

    fn pick_room(&self, request: &RoomRequest) -> Result<mpsc::Sender<RoomCmd>, String> {
        let mut rooms = self.rooms.lock().expect("rooms lock poisoned");
        rooms.retain(|r| !r.tx.is_closed());

        match request {
            RoomRequest::Join(id) => {
                let room = rooms
                    .iter()
                    .find(|r| r.id == *id)
                    .ok_or("That room has closed")?;
                if !room.has_space() {
                    return Err("That room is full".into());
                }
                Ok(room.tx.clone())
            }
            RoomRequest::Quick { mode } => {
                // Prefer the busiest room that still has space, so players
                // end up together instead of spread over empty rooms.
                if let Some(room) = rooms
                    .iter()
                    .filter(|r| r.mode == *mode && r.has_space())
                    .max_by_key(|r| r.status.borrow().players)
                {
                    return Ok(room.tx.clone());
                }
                self.open_room(&mut rooms, None, *mode)
            }
            RoomRequest::Create { name, mode } => self.open_room(&mut rooms, Some(name), *mode),
        }
    }

    fn open_room(
        &self,
        rooms: &mut Vec<RoomHandle>,
        name: Option<&str>,
        mode: GameMode,
    ) -> Result<mpsc::Sender<RoomCmd>, String> {
        if rooms.len() >= MAX_ROOMS {
            return Err("The server has too many rooms open, join an existing one".into());
        }
        let id = self.next_room_id.fetch_add(1, Ordering::Relaxed) + 1;
        let name: Arc<str> = match name.filter(|n| !n.is_empty()) {
            Some(n) => n.into(),
            None => format!("{} {id}", mode_label(mode)).into(),
        };
        let (tx, rx) = mpsc::channel(ROOM_INBOX);
        let (status_tx, status_rx) = watch::channel(RoomStatus::default());
        tokio::spawn(Room::new(id, name.clone(), mode, status_tx).run(rx));
        tracing::info!(room = id, name = %name, ?mode, "room created");
        rooms.push(RoomHandle {
            id,
            name,
            mode,
            tx: tx.clone(),
            status: status_rx,
        });
        Ok(tx)
    }

    fn list(&self) -> Vec<RoomSummary> {
        let mut rooms = self.rooms.lock().expect("rooms lock poisoned");
        rooms.retain(|r| !r.tx.is_closed());
        let mut list: Vec<RoomSummary> = rooms
            .iter()
            .map(|r| {
                let s = *r.status.borrow();
                RoomSummary {
                    id: r.id,
                    name: r.name.to_string(),
                    mode: r.mode,
                    players: s.players,
                    max_players: MAX_PLAYERS_PER_ROOM,
                    phase: s.phase,
                    round: s.round,
                    score_t: s.score_t,
                    score_ct: s.score_ct,
                }
            })
            .collect();
        list.sort_by(|a, b| b.players.cmp(&a.players).then(a.id.cmp(&b.id)));
        list
    }
}

#[derive(Serialize)]
pub struct RoomSummary {
    id: RoomId,
    name: String,
    mode: GameMode,
    players: usize,
    max_players: usize,
    phase: &'static str,
    round: u16,
    score_t: u16,
    score_ct: u16,
}

fn mode_label(mode: GameMode) -> &'static str {
    match mode {
        GameMode::Elimination => "Elimination",
        GameMode::TeamDeathmatch => "Team DM",
        GameMode::Deathmatch => "Deathmatch",
    }
}

/// `GET /api/rooms`: the lobby's room browser.
pub async fn list_rooms(State(state): State<AppState>) -> Json<Vec<RoomSummary>> {
    Json(state.rooms.list())
}
