//! JS bindings (built with `--features wasm`). The client uses these for the
//! protocol, the map, and client-side prediction with the server's own
//! movement code.

use alloc::collections::VecDeque;
use alloc::string::String;
use alloc::vec::Vec;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::constants::*;
use crate::map::{MAP, raycast_map};
use crate::math::Vec3;
use crate::movement::{MoveState, step};
use crate::protocol::{
    self, Buttons, ClientMsg, InputCmd, PROTOCOL_VERSION, RoomRequest, ServerMsg, Team,
};

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(value).map_err(|e| JsError::new(&e.to_string()))
}

/// `room` is `"Quick"`, `{ Join: id }` or `{ Create: { name } }`;
/// `team` is `"T"`, `"Ct"` or null/undefined for auto.
#[wasm_bindgen]
pub fn encode_hello(name: String, room: JsValue, team: JsValue) -> Result<Vec<u8>, JsError> {
    let room: RoomRequest =
        serde_wasm_bindgen::from_value(room).map_err(|e| JsError::new(&e.to_string()))?;
    let team: Option<Team> =
        serde_wasm_bindgen::from_value(team).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(protocol::encode(&ClientMsg::Hello {
        version: PROTOCOL_VERSION,
        name,
        room,
        team,
    }))
}

/// Decode a server frame into a plain JS object (see client/src/net/protocol.ts).
#[wasm_bindgen]
pub fn decode_server(bytes: &[u8]) -> Result<JsValue, JsError> {
    let msg: ServerMsg = protocol::decode(bytes).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&msg)
}

#[wasm_bindgen]
pub fn map_boxes() -> Result<JsValue, JsError> {
    to_js(&MAP)
}

/// Distance to the first map hit, or `max_dist` when nothing is hit.
#[wasm_bindgen]
pub fn raycast(ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, max_dist: f32) -> f32 {
    raycast_map(Vec3::new(ox, oy, oz), Vec3::new(dx, dy, dz), max_dist).unwrap_or(max_dist)
}

#[derive(Serialize)]
struct Constants {
    tick_rate: u32,
    dt: f32,
    eye_height: f32,
    player_height: f32,
    player_half_width: f32,
    head_start: f32,
    mag_size: u8,
    fire_interval: f32,
    max_health: u8,
    max_speed: f32,
    sprint_speed: f32,
    slide_eye_height: f32,
    max_range: f32,
    rounds_to_win: u16,
    tdm_kill_limit: u16,
    dm_kill_limit: u16,
}

#[wasm_bindgen]
pub fn constants() -> Result<JsValue, JsError> {
    to_js(&Constants {
        tick_rate: TICK_RATE,
        dt: DT,
        eye_height: EYE_HEIGHT,
        player_height: PLAYER_HEIGHT,
        player_half_width: PLAYER_HALF_WIDTH,
        head_start: HEAD_START,
        mag_size: MAG_SIZE,
        fire_interval: FIRE_INTERVAL,
        max_health: MAX_HEALTH,
        max_speed: MAX_SPEED,
        sprint_speed: SPRINT_SPEED,
        slide_eye_height: SLIDE_EYE_HEIGHT,
        max_range: MAX_RANGE,
        rounds_to_win: ROUNDS_TO_WIN,
        tdm_kill_limit: TDM_KILL_LIMIT,
        dm_kill_limit: DM_KILL_LIMIT,
    })
}

const MAX_PENDING: usize = 256;

#[derive(Clone, Copy)]
struct Pending {
    cmd: InputCmd,
    can_move: bool,
}

/// Client-side prediction for the local player.
#[wasm_bindgen]
pub struct LocalSim {
    state: MoveState,
    prev: MoveState,
    pending: VecDeque<Pending>,
    next_seq: u32,
}

#[wasm_bindgen]
impl LocalSim {
    #[wasm_bindgen(constructor)]
    pub fn new() -> LocalSim {
        LocalSim {
            state: MoveState::default(),
            prev: MoveState::default(),
            pending: VecDeque::new(),
            next_seq: 1,
        }
    }

    /// Run one predicted tick and return the encoded `Input` message to send.
    pub fn tick(
        &mut self,
        forward: i8,
        right: i8,
        buttons: u8,
        yaw: f32,
        pitch: f32,
        can_move: bool,
    ) -> Vec<u8> {
        let cmd = InputCmd {
            seq: self.next_seq,
            forward: forward.clamp(-1, 1),
            right: right.clamp(-1, 1),
            buttons: Buttons(buttons),
            yaw,
            pitch,
        };
        self.next_seq = self.next_seq.wrapping_add(1);

        self.prev = self.state;
        self.state = step(&self.state, &cmd, can_move);

        if self.pending.len() == MAX_PENDING {
            self.pending.pop_front();
        }
        self.pending.push_back(Pending { cmd, can_move });

        protocol::encode(&ClientMsg::Input(cmd))
    }

    /// Accept the server's state for the last acknowledged input, then
    /// replay every input the server has not processed yet.
    #[allow(clippy::too_many_arguments)]
    pub fn reconcile(
        &mut self,
        ack_seq: u32,
        px: f32,
        py: f32,
        pz: f32,
        vx: f32,
        vy: f32,
        vz: f32,
        on_ground: bool,
        slide: f32,
        slide_cooldown: f32,
        slide_held: bool,
    ) {
        while self.pending.front().is_some_and(|p| p.cmd.seq <= ack_seq) {
            self.pending.pop_front();
        }
        let before = self.state;
        let mut s = MoveState {
            pos: Vec3::new(px, py, pz),
            vel: Vec3::new(vx, vy, vz),
            on_ground,
            slide,
            slide_cooldown,
            slide_held,
        };
        for p in &self.pending {
            s = step(&s, &p.cmd, p.can_move);
        }
        // Shift the interpolation origin by the same correction so a small
        // fix doesn't show up as a one-frame jitter.
        let correction = s.pos - before.pos;
        self.prev.pos += correction;
        self.state = s;
    }

    /// Hard reset (spawn / respawn).
    pub fn teleport(&mut self, x: f32, y: f32, z: f32) {
        self.state = MoveState {
            pos: Vec3::new(x, y, z),
            ..Default::default()
        };
        self.prev = self.state;
        self.pending.clear();
    }

    /// Writes the feet position interpolated between the last two ticks.
    pub fn render_pos(&self, alpha: f32, out: &mut [f32]) {
        let a = self.prev.pos;
        let b = self.state.pos;
        out[0] = a.x + (b.x - a.x) * alpha;
        out[1] = a.y + (b.y - a.y) * alpha;
        out[2] = a.z + (b.z - a.z) * alpha;
    }

    pub fn horizontal_speed(&self) -> f32 {
        let v = self.state.vel;
        libm::sqrtf(v.x * v.x + v.z * v.z)
    }

    pub fn on_ground(&self) -> bool {
        self.state.on_ground
    }

    pub fn sliding(&self) -> bool {
        self.state.sliding()
    }

    /// Eye height for the predicted state (drops while sliding).
    pub fn eye_height(&self) -> f32 {
        self.state.eye_height()
    }

    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }
}

impl Default for LocalSim {
    fn default() -> Self {
        Self::new()
    }
}
