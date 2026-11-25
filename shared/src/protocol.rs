//! Wire protocol. Binary-encoded with postcard over WebSocket binary frames.
//!
//! Flow: client sends `Hello`, server answers `Welcome`, then the client
//! sends one `Input` per tick and the server sends one `Snapshot` per tick.

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

use crate::math::Vec3;

pub const PROTOCOL_VERSION: u16 = 3;

pub type RoomId = u32;

pub type PlayerId = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Team {
    T,
    Ct,
}

impl Team {
    pub fn other(self) -> Self {
        match self {
            Team::T => Team::Ct,
            Team::Ct => Team::T,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Buttons(pub u8);

impl Buttons {
    pub const JUMP: u8 = 1 << 0;
    pub const FIRE: u8 = 1 << 1;
    pub const RELOAD: u8 = 1 << 2;
    pub const WALK: u8 = 1 << 3;
    pub const SPRINT: u8 = 1 << 4;
    pub const SLIDE: u8 = 1 << 5;

    pub fn has(self, flag: u8) -> bool {
        self.0 & flag != 0
    }
}

/// One tick of player input.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct InputCmd {
    pub seq: u32,
    /// -1, 0 or 1.
    pub forward: i8,
    /// -1, 0 or 1.
    pub right: i8,
    pub buttons: Buttons,
    pub yaw: f32,
    pub pitch: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GameMode {
    /// Round-based, no respawns; first team to `ROUNDS_TO_WIN` rounds.
    Elimination,
    /// Two teams, instant respawns; first team to `TDM_KILL_LIMIT` kills.
    TeamDeathmatch,
    /// Free-for-all, instant respawns; first player to `DM_KILL_LIMIT`.
    Deathmatch,
}

impl GameMode {
    pub fn has_teams(self) -> bool {
        !matches!(self, GameMode::Deathmatch)
    }

    pub fn respawns(self) -> bool {
        !matches!(self, GameMode::Elimination)
    }
}

/// Which room the client wants to play in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoomRequest {
    /// Any room of this mode with space; a new one is opened if all are full.
    Quick { mode: GameMode },
    Join(RoomId),
    Create { name: String, mode: GameMode },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClientMsg {
    Hello {
        version: u16,
        name: String,
        room: RoomRequest,
        /// Preferred side. Honored unless it would unbalance the teams.
        team: Option<Team>,
    },
    Input(InputCmd),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    /// Not enough players for rounds: free respawns.
    Warmup,
    Freeze,
    Live,
    RoundEnd { winner: Team },
    /// Match decided; a new one starts when the timer runs out.
    MatchEnd { winner: MatchWinner },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchWinner {
    Team(Team),
    Player(PlayerId),
    Draw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub id: PlayerId,
    pub name: String,
    pub team: Team,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerSnap {
    pub id: PlayerId,
    pub team: Team,
    pub pos: Vec3,
    pub vel: Vec3,
    pub on_ground: bool,
    /// Slide state, needed to replay predicted inputs exactly.
    pub slide: f32,
    pub slide_cooldown: f32,
    pub slide_held: bool,
    pub yaw: f32,
    pub pitch: f32,
    pub health: u8,
    pub alive: bool,
    pub ammo: u8,
    pub reloading: bool,
    pub kills: u16,
    pub deaths: u16,
    /// Increments on every (re)spawn so the client knows to snap its
    /// prediction and view angles to the spawn.
    pub spawn_id: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GameEvent {
    Joined(PlayerInfo),
    Left { id: PlayerId },
    Shot { shooter: PlayerId, from: Vec3, to: Vec3, hit: Option<PlayerId> },
    Kill { killer: PlayerId, victim: PlayerId, headshot: bool },
    RoundStart { round: u16 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub tick: u32,
    /// Last input seq the server applied for the receiving client.
    pub ack_seq: u32,
    pub phase: Phase,
    pub phase_time_left: f32,
    pub round: u16,
    pub score_t: u16,
    pub score_ct: u16,
    pub players: Vec<PlayerSnap>,
    pub events: Vec<GameEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServerMsg {
    Welcome {
        your_id: PlayerId,
        room_id: RoomId,
        room_name: String,
        mode: GameMode,
        tick_rate: u32,
        roster: Vec<PlayerInfo>,
    },
    Snapshot(Snapshot),
    Rejected { reason: String },
}

pub fn encode<T: Serialize>(msg: &T) -> Vec<u8> {
    postcard::to_allocvec(msg).expect("protocol messages always serialize")
}

pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, postcard::Error> {
    postcard::from_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_roundtrip() {
        let msg = ClientMsg::Hello {
            version: PROTOCOL_VERSION,
            name: "alpha".into(),
            room: RoomRequest::Create {
                name: "Yard".into(),
                mode: GameMode::Deathmatch,
            },
            team: Some(Team::Ct),
        };
        match decode::<ClientMsg>(&encode(&msg)).unwrap() {
            ClientMsg::Hello { room, team, .. } => {
                assert_eq!(
                    room,
                    RoomRequest::Create {
                        name: "Yard".into(),
                        mode: GameMode::Deathmatch
                    }
                );
                assert_eq!(team, Some(Team::Ct));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn input_roundtrip() {
        let cmd = InputCmd {
            seq: 42,
            forward: 1,
            right: -1,
            buttons: Buttons(Buttons::FIRE | Buttons::JUMP),
            yaw: 1.5,
            pitch: -0.25,
        };
        let bytes = encode(&ClientMsg::Input(cmd));
        assert!(bytes.len() < 16, "input is {} bytes", bytes.len());
        match decode::<ClientMsg>(&bytes).unwrap() {
            ClientMsg::Input(c) => assert_eq!(c, cmd),
            other => panic!("unexpected {other:?}"),
        }
    }
}
