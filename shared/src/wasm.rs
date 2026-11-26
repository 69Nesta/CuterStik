//! JS bindings (built with `--features wasm`). The client uses these for the
//! protocol, the map, and client-side prediction with the server's own
//! movement code.

use alloc::collections::VecDeque;
use alloc::string::String;
use alloc::vec::Vec;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::combat::{shot_direction, shot_random};
use crate::constants::*;
use crate::map::{BOMB_SITES, BUY_ZONES, MAP, RAMPS, raycast_map};
use crate::math::Vec3;
use crate::movement::{MoveState, step};
use crate::protocol::{
    self, Buttons, BuyItem, ClientMsg, InputCmd, PROTOCOL_VERSION, RoomRequest, ServerMsg, Team,
};
use crate::weapons::{Arsenal, WeaponId, WeaponSpec, inaccuracy, spray_offset};

fn from_js<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|e| JsError::new(&e.to_string()))
}

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

/// `item` is `{ Weapon: "Rifle" }`, `"Kevlar"` or `"KevlarHelmet"`.
#[wasm_bindgen]
pub fn encode_buy(item: JsValue) -> Result<Vec<u8>, JsError> {
    let item: BuyItem = from_js(item)?;
    Ok(protocol::encode(&ClientMsg::Buy(item)))
}

#[wasm_bindgen]
pub fn map_boxes() -> Result<JsValue, JsError> {
    to_js(&MAP)
}

#[wasm_bindgen]
pub fn map_ramps() -> Result<JsValue, JsError> {
    to_js(&RAMPS)
}

#[wasm_bindgen]
pub fn bomb_sites() -> Result<JsValue, JsError> {
    to_js(&BOMB_SITES)
}

#[wasm_bindgen]
pub fn buy_zones() -> Result<JsValue, JsError> {
    to_js(&BUY_ZONES)
}

#[wasm_bindgen]
pub fn weapons() -> Result<JsValue, JsError> {
    let all: Vec<&WeaponSpec> = WeaponId::ALL.iter().map(|w| w.spec()).collect();
    to_js(&all)
}

/// Recoil pattern offset (pitch, yaw) after `spray` shots.
#[wasm_bindgen]
pub fn spray_kick(weapon: JsValue, spray: f32, out: &mut [f32]) -> Result<(), JsError> {
    let w: WeaponId = from_js(weapon)?;
    let (p, y) = spray_offset(w.spec(), spray);
    out[0] = p;
    out[1] = y;
    Ok(())
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
    crouch_height: f32,
    crouch_eye_height: f32,
    player_half_width: f32,
    head_start: f32,
    max_health: u8,
    max_armor: u8,
    draw_time: f32,
    slide_cooldown: f32,
    max_speed: f32,
    sprint_speed: f32,
    slide_eye_height: f32,
    max_range: f32,
    rounds_to_win: u16,
    tdm_kill_limit: u16,
    dm_kill_limit: u16,
    start_money: u16,
    buy_time: f32,
    kevlar_price: u16,
    kevlar_helmet_price: u16,
    plant_time: f32,
    defuse_time: f32,
    bomb_timer: f32,
    bomb_radius: f32,
    defuse_range: f32,
}

#[wasm_bindgen]
pub fn constants() -> Result<JsValue, JsError> {
    to_js(&Constants {
        tick_rate: TICK_RATE,
        dt: DT,
        eye_height: EYE_HEIGHT,
        player_height: PLAYER_HEIGHT,
        crouch_height: CROUCH_HEIGHT,
        crouch_eye_height: CROUCH_EYE_HEIGHT,
        player_half_width: PLAYER_HALF_WIDTH,
        head_start: HEAD_START,
        max_health: MAX_HEALTH,
        max_armor: MAX_ARMOR,
        draw_time: DRAW_TIME,
        slide_cooldown: SLIDE_COOLDOWN,
        max_speed: MAX_SPEED,
        sprint_speed: SPRINT_SPEED,
        slide_eye_height: SLIDE_EYE_HEIGHT,
        max_range: MAX_RANGE,
        rounds_to_win: ROUNDS_TO_WIN,
        tdm_kill_limit: TDM_KILL_LIMIT,
        dm_kill_limit: DM_KILL_LIMIT,
        start_money: START_MONEY,
        buy_time: BUY_TIME,
        kevlar_price: KEVLAR_PRICE,
        kevlar_helmet_price: KEVLAR_HELMET_PRICE,
        plant_time: PLANT_TIME,
        defuse_time: DEFUSE_TIME,
        bomb_timer: BOMB_TIMER,
        bomb_radius: BOMB_RADIUS,
        defuse_range: DEFUSE_RANGE,
    })
}

const MAX_PENDING: usize = 256;

#[derive(Clone, Copy)]
struct Pending {
    cmd: InputCmd,
    can_move: bool,
}

/// A predicted shot, kept until the client reads it with `take_shot`.
#[derive(Clone, Copy)]
struct Shot {
    weapon: WeaponId,
    origin: Vec3,
    dir: Vec3,
}

/// One predicted tick: movement and weapons, exactly as the server runs it.
fn sim_step(
    id: u32,
    mv: &MoveState,
    arsenal: &mut Arsenal,
    cmd: &InputCmd,
    can_act: bool,
) -> (MoveState, Option<Shot>) {
    let shot = arsenal.tick(cmd.buttons, can_act).map(|f| {
        let spec = f.weapon.spec();
        let cone = inaccuracy(
            spec,
            mv.horizontal_speed(),
            mv.on_ground,
            mv.crouched,
            arsenal.zoomed,
        );
        Shot {
            weapon: f.weapon,
            origin: Vec3::new(mv.pos.x, mv.pos.y + mv.eye_height(), mv.pos.z),
            dir: shot_direction(
                cmd.yaw,
                cmd.pitch,
                spec,
                f.spray,
                cone,
                shot_random(id, cmd.seq),
            ),
        }
    });
    (step(mv, cmd, can_act, arsenal.speed_scale()), shot)
}

/// Client-side prediction for the local player.
#[wasm_bindgen]
pub struct LocalSim {
    id: u32,
    state: MoveState,
    arsenal: Arsenal,
    prev: MoveState,
    pending: VecDeque<Pending>,
    next_seq: u32,
    shot: Option<Shot>,
}

#[wasm_bindgen]
impl LocalSim {
    #[wasm_bindgen(constructor)]
    pub fn new(id: u32) -> LocalSim {
        LocalSim {
            id,
            state: MoveState::default(),
            arsenal: Arsenal::new(),
            prev: MoveState::default(),
            pending: VecDeque::new(),
            next_seq: 1,
            shot: None,
        }
    }

    /// Run one predicted tick and return the encoded `Input` message to send.
    #[allow(clippy::too_many_arguments)]
    pub fn tick(
        &mut self,
        forward: i8,
        right: i8,
        buttons: u16,
        yaw: f32,
        pitch: f32,
        can_act: bool,
        view_time: u32,
    ) -> Vec<u8> {
        let cmd = InputCmd {
            seq: self.next_seq,
            forward: forward.clamp(-1, 1),
            right: right.clamp(-1, 1),
            buttons: Buttons(buttons),
            yaw,
            pitch,
            view_time,
        };
        self.next_seq = self.next_seq.wrapping_add(1);

        self.prev = self.state;
        let (next, shot) = sim_step(self.id, &self.state, &mut self.arsenal, &cmd, can_act);
        self.state = next;
        if shot.is_some() {
            self.shot = shot;
        }

        if self.pending.len() == MAX_PENDING {
            self.pending.pop_front();
        }
        self.pending.push_back(Pending {
            cmd,
            can_move: can_act,
        });

        protocol::encode(&ClientMsg::Input(cmd))
    }

    /// The last predicted shot since the previous call: writes origin and
    /// direction into `out` (6 floats) and returns the weapon, or null.
    pub fn take_shot(&mut self, out: &mut [f32]) -> Result<JsValue, JsError> {
        let Some(s) = self.shot.take() else {
            return Ok(JsValue::NULL);
        };
        out[..6].copy_from_slice(&[
            s.origin.x, s.origin.y, s.origin.z, s.dir.x, s.dir.y, s.dir.z,
        ]);
        to_js(&s.weapon)
    }

    /// Accept the server's state for the last acknowledged input, then
    /// replay every input the server has not processed yet.
    pub fn reconcile(
        &mut self,
        ack_seq: u32,
        mv: JsValue,
        arsenal: JsValue,
    ) -> Result<(), JsError> {
        let mut s: MoveState = from_js(mv)?;
        let mut a: Arsenal = from_js(arsenal)?;
        while self.pending.front().is_some_and(|p| p.cmd.seq <= ack_seq) {
            self.pending.pop_front();
        }
        let before = self.state;
        for p in &self.pending {
            s = sim_step(self.id, &s, &mut a, &p.cmd, p.can_move).0;
        }
        // Shift the interpolation origin by the same correction so a small
        // fix doesn't show up as a one-frame jitter.
        let correction = s.pos - before.pos;
        self.prev.pos += correction;
        self.state = s;
        self.arsenal = a;
        Ok(())
    }

    /// Hard reset (spawn / respawn).
    pub fn teleport(&mut self, mv: JsValue, arsenal: JsValue) -> Result<(), JsError> {
        self.state = from_js(mv)?;
        self.arsenal = from_js(arsenal)?;
        self.prev = self.state;
        self.pending.clear();
        self.shot = None;
        Ok(())
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
        self.state.horizontal_speed()
    }

    pub fn on_ground(&self) -> bool {
        self.state.on_ground
    }

    pub fn sliding(&self) -> bool {
        self.state.sliding()
    }

    pub fn crouched(&self) -> bool {
        self.state.crouched
    }

    /// Eye height for the predicted state (drops while crouched / sliding).
    pub fn eye_height(&self) -> f32 {
        self.state.eye_height()
    }

    /// Predicted weapons: what's in hand, ammo, timers.
    pub fn arsenal(&self) -> Result<JsValue, JsError> {
        to_js(&self.arsenal)
    }

    pub fn zoomed(&self) -> bool {
        self.arsenal.zoomed
    }

    /// Current recoil pattern offset (pitch, yaw), for the view punch.
    pub fn view_kick(&self, out: &mut [f32]) {
        let (p, y) = spray_offset(self.arsenal.spec(), self.arsenal.spray);
        out[0] = p;
        out[1] = y;
    }

    /// Inaccuracy cone of the weapon in hand right now (radians).
    pub fn inaccuracy(&self) -> f32 {
        let s = &self.state;
        inaccuracy(
            self.arsenal.spec(),
            s.horizontal_speed(),
            s.on_ground,
            s.crouched,
            self.arsenal.zoomed,
        )
    }

    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }
}
