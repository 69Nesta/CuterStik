//! Deterministic player movement. The server runs it authoritatively and
//! the client runs the exact same code (compiled to wasm) for prediction.
//! Math goes through `libm` so native and wasm builds give the same results.

use serde::{Deserialize, Serialize};

use crate::constants::*;
use crate::map::colliders;
use crate::math::{Aabb, Vec3};
use crate::protocol::{Buttons, InputCmd};

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct MoveState {
    /// Feet center.
    pub pos: Vec3,
    pub vel: Vec3,
    pub on_ground: bool,
    /// Seconds left in the current slide; 0 when not sliding.
    pub slide: f32,
    /// Seconds until a new slide may start.
    pub slide_cooldown: f32,
    /// Crouch button state last tick, so a slide starts on press only.
    pub slide_held: bool,
    /// Short collision box (crouching or sliding).
    pub crouched: bool,
}

impl MoveState {
    pub fn sliding(&self) -> bool {
        self.slide > 0.0
    }

    pub fn height(&self) -> f32 {
        if self.crouched {
            CROUCH_HEIGHT
        } else {
            PLAYER_HEIGHT
        }
    }

    pub fn eye_height(&self) -> f32 {
        if self.sliding() {
            SLIDE_EYE_HEIGHT
        } else if self.crouched {
            CROUCH_EYE_HEIGHT
        } else {
            EYE_HEIGHT
        }
    }

    pub fn horizontal_speed(&self) -> f32 {
        libm::sqrtf(self.vel.x * self.vel.x + self.vel.z * self.vel.z)
    }
}

pub fn player_bounds(pos: Vec3, height: f32) -> Aabb {
    Aabb::new(
        Vec3::new(pos.x - PLAYER_HALF_WIDTH, pos.y, pos.z - PLAYER_HALF_WIDTH),
        Vec3::new(
            pos.x + PLAYER_HALF_WIDTH,
            pos.y + height,
            pos.z + PLAYER_HALF_WIDTH,
        ),
    )
}

fn blocked_at(pos: Vec3, height: f32) -> bool {
    let me = player_bounds(pos, height);
    colliders().iter().any(|b| me.overlaps(b))
}

/// Advance one tick. `can_move` is false during freeze time: gravity still
/// applies but movement input and jumping are ignored. `speed_scale` is the
/// held weapon's movement multiplier.
pub fn step(state: &MoveState, cmd: &InputCmd, can_move: bool, speed_scale: f32) -> MoveState {
    let mut s = *state;

    let (fwd, right) = if can_move {
        (cmd.forward as f32, cmd.right as f32)
    } else {
        (0.0, 0.0)
    };

    // Wish direction on the XZ plane, from yaw only.
    let (sy, cy) = (libm::sinf(cmd.yaw), libm::cosf(cmd.yaw));
    let forward_dir = Vec3::new(-sy, 0.0, -cy);
    let right_dir = Vec3::new(cy, 0.0, -sy);
    let mut wish = forward_dir * fwd + right_dir * right;
    let wish_len = wish.length();
    if wish_len > 1e-6 {
        wish = wish * (1.0 / wish_len);
    }

    // Crouch / slide share one button: pressed at speed it slides,
    // otherwise it crouches. Timers advance every tick, frozen or not.
    let crouch_held = cmd.buttons.has(Buttons::CROUCH);
    s.slide_cooldown = (s.slide_cooldown - DT).max(0.0);
    s.slide = (s.slide - DT).max(0.0);
    let slide_pressed = can_move && crouch_held;
    let slide_edge = slide_pressed && !s.slide_held;
    s.slide_held = crouch_held;

    if s.on_ground
        && slide_edge
        && !s.sliding()
        && s.slide_cooldown == 0.0
        && s.horizontal_speed() >= SLIDE_MIN_SPEED
    {
        // Kick along the current direction of travel.
        let speed = s.horizontal_speed();
        let boosted = (speed + SLIDE_BOOST).min(SLIDE_MAX_SPEED).max(speed);
        s.vel.x *= boosted / speed;
        s.vel.z *= boosted / speed;
        s.slide = SLIDE_TIME;
        s.slide_cooldown = SLIDE_COOLDOWN;
    }
    // Letting go, leaving the ground or losing speed ends the slide.
    if s.sliding() && (!slide_pressed || !s.on_ground || s.horizontal_speed() < SLIDE_END_SPEED) {
        s.slide = 0.0;
    }
    if crouch_held || s.sliding() {
        s.crouched = true;
    } else if s.crouched && !blocked_at(s.pos, PLAYER_HEIGHT) {
        // Stand up only where there's headroom.
        s.crouched = false;
    }

    let walking = cmd.buttons.has(Buttons::WALK);
    // Sprint: forward only, and firing or crouching drops you to a run.
    let sprinting = cmd.buttons.has(Buttons::SPRINT)
        && fwd > 0.0
        && !walking
        && !s.crouched
        && !cmd.buttons.has(Buttons::FIRE);
    let mut wish_speed = if wish_len <= 1e-6 {
        0.0
    } else if sprinting {
        SPRINT_SPEED
    } else if s.crouched {
        MAX_SPEED * CROUCH_SPEED_FACTOR
    } else if walking {
        MAX_SPEED * WALK_SPEED_FACTOR
    } else {
        MAX_SPEED
    } * speed_scale;
    if s.sliding() {
        // Committed to the slide: only a little steering.
        wish_speed = wish_speed.min(1.0);
    }

    let jump = can_move && cmd.buttons.has(Buttons::JUMP);
    if s.on_ground {
        if jump {
            // Skip friction on the jump tick so bunny hops (and slide
            // jumps) keep their speed.
            s.vel.y = JUMP_SPEED;
            s.on_ground = false;
            s.slide = 0.0;
        } else if s.sliding() {
            apply_friction_with(&mut s.vel, SLIDE_FRICTION);
        } else {
            apply_friction(&mut s.vel);
        }
        accelerate(&mut s.vel, wish, wish_speed, wish_speed, GROUND_ACCEL);
    } else {
        accelerate(
            &mut s.vel,
            wish,
            wish_speed.min(AIR_SPEED_CAP),
            wish_speed,
            AIR_ACCEL,
        );
    }

    if !s.on_ground {
        s.vel.y = (s.vel.y - GRAVITY * DT).max(-MAX_FALL_SPEED);
    }

    let was_on_ground = s.on_ground;
    move_and_collide(&mut s, was_on_ground);

    // Stick to the ground walking down stairs and ramps.
    if was_on_ground && s.vel.y <= 0.0 && !touching_ground(s.pos, s.height()) {
        snap_down(&mut s);
    }

    s.on_ground = s.vel.y <= 0.0 && touching_ground(s.pos, s.height());
    if s.on_ground {
        s.vel.y = 0.0;
    }
    s
}

fn apply_friction(vel: &mut Vec3) {
    apply_friction_with(vel, FRICTION);
}

fn apply_friction_with(vel: &mut Vec3, friction: f32) {
    let speed = libm::sqrtf(vel.x * vel.x + vel.z * vel.z);
    if speed < 1e-4 {
        vel.x = 0.0;
        vel.z = 0.0;
        return;
    }
    let control = speed.max(STOP_SPEED);
    let new_speed = (speed - control * friction * DT).max(0.0);
    let scale = new_speed / speed;
    vel.x *= scale;
    vel.z *= scale;
}

/// Quake/Source acceleration. `cap` limits the speed gained along `wish`
/// (the air-strafe cap); `accel_ref` scales the acceleration amount.
fn accelerate(vel: &mut Vec3, wish: Vec3, cap: f32, accel_ref: f32, accel: f32) {
    if cap <= 0.0 {
        return;
    }
    let current = vel.dot(wish);
    let add = cap - current;
    if add <= 0.0 {
        return;
    }
    let amount = (accel * accel_ref * DT).min(add);
    vel.x += wish.x * amount;
    vel.z += wish.z * amount;
}

/// Axis-separated move: X, then Z, then Y. Simple and stable against boxes.
/// On the ground, a horizontal move blocked only by ledges up to
/// `STEP_HEIGHT` steps up onto them instead.
fn move_and_collide(s: &mut MoveState, grounded: bool) {
    let height = s.height();
    for axis in [0usize, 2, 1] {
        let delta = s.vel.get(axis) * DT;
        if delta == 0.0 {
            continue;
        }
        let mut pos = s.pos;
        pos.set(axis, pos.get(axis) + delta);

        if axis != 1
            && grounded
            && let Some(top) = step_up_height(pos, height)
        {
            s.pos = Vec3::new(pos.x, top, pos.z);
            continue;
        }

        let mut blocked = false;
        for b in colliders() {
            let me = player_bounds(pos, height);
            if !me.overlaps(b) {
                continue;
            }
            blocked = true;
            let resolved = match (axis, delta > 0.0) {
                (1, true) => b.min.y - height,
                (1, false) => b.max.y,
                (_, true) => b.min.get(axis) - PLAYER_HALF_WIDTH,
                (_, false) => b.max.get(axis) + PLAYER_HALF_WIDTH,
            };
            pos.set(axis, resolved);
        }
        s.pos = pos;
        if blocked {
            s.vel.set(axis, 0.0);
        }
    }
}

/// If everything overlapping `pos` is a low ledge with headroom above,
/// the feet height to step up to.
fn step_up_height(pos: Vec3, height: f32) -> Option<f32> {
    let me = player_bounds(pos, height);
    let mut top = None::<f32>;
    for b in colliders() {
        if !me.overlaps(b) {
            continue;
        }
        let rise = b.max.y - pos.y;
        if rise <= 0.0 || rise > STEP_HEIGHT {
            return None;
        }
        top = Some(top.map_or(b.max.y, |t| t.max(b.max.y)));
    }
    let top = top?;
    (!blocked_at(Vec3::new(pos.x, top, pos.z), height)).then_some(top)
}

/// Drop onto ground up to `STEP_HEIGHT` below, if there is any.
fn snap_down(s: &mut MoveState) {
    let probe = player_bounds(
        Vec3::new(s.pos.x, s.pos.y - STEP_HEIGHT, s.pos.z),
        s.height(),
    );
    let ground = colliders()
        .iter()
        .filter(|b| probe.overlaps(b) && b.max.y <= s.pos.y)
        .map(|b| b.max.y)
        .fold(None::<f32>, |m, y| Some(m.map_or(y, |m| m.max(y))));
    if let Some(y) = ground {
        s.pos.y = y;
    }
}

fn touching_ground(pos: Vec3, height: f32) -> bool {
    let probe = player_bounds(Vec3::new(pos.x, pos.y - 0.01, pos.z), height);
    colliders().iter().any(|b| probe.overlaps(b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Buttons;

    fn cmd(forward: i8, buttons: u16) -> InputCmd {
        InputCmd {
            seq: 0,
            forward,
            right: 0,
            buttons: Buttons(buttons),
            view_time: 0,
            yaw: 0.0,
            pitch: 0.0,
        }
    }

    #[test]
    fn falls_and_lands_on_floor() {
        let mut s = MoveState {
            pos: Vec3::new(0.0, 3.0, 5.0),
            ..Default::default()
        };
        for _ in 0..200 {
            s = step(&s, &cmd(0, 0), true, 1.0);
        }
        assert!(s.on_ground);
        assert_eq!(s.pos.y, 0.0);
    }

    #[test]
    fn runs_forward_toward_negative_z_up_to_max_speed() {
        let mut s = MoveState {
            pos: Vec3::new(0.0, 0.0, 26.0),
            on_ground: true,
            ..Default::default()
        };
        for _ in 0..64 {
            s = step(&s, &cmd(1, 0), true, 1.0);
        }
        assert!(s.pos.z < 26.0);
        let speed = libm::sqrtf(s.vel.x * s.vel.x + s.vel.z * s.vel.z);
        assert!((speed - MAX_SPEED).abs() < 0.05, "speed {speed}");
    }

    #[test]
    fn blocked_by_wall() {
        // T spawn running toward -Z hits the low wall at z = 19.
        let mut s = MoveState {
            pos: Vec3::new(0.0, 0.0, 22.0),
            on_ground: true,
            ..Default::default()
        };
        for _ in 0..128 {
            s = step(&s, &cmd(1, 0), true, 1.0);
        }
        assert!((s.pos.z - (19.0 + PLAYER_HALF_WIDTH)).abs() < 1e-4);
    }

    #[test]
    fn jump_clears_one_meter_crate_but_not_two() {
        let mut s = MoveState {
            pos: Vec3::new(0.0, 0.0, 5.0),
            on_ground: true,
            ..Default::default()
        };
        let mut apex = 0.0f32;
        s = step(&s, &cmd(0, Buttons::JUMP), true, 1.0);
        for _ in 0..64 {
            s = step(&s, &cmd(0, 0), true, 1.0);
            apex = apex.max(s.pos.y);
        }
        assert!(apex > 1.2 && apex < 1.5, "apex {apex}");
    }

    fn run(s: &mut MoveState, ticks: usize, buttons: u16) -> f32 {
        let mut top = 0.0f32;
        for _ in 0..ticks {
            *s = step(s, &cmd(1, buttons), true, 1.0);
            top = top.max(s.horizontal_speed());
        }
        top
    }

    fn open_ground() -> MoveState {
        // Long open stretch in the west lane, running toward -Z.
        MoveState {
            pos: Vec3::new(-25.0, 0.0, 28.0),
            on_ground: true,
            ..Default::default()
        }
    }

    #[test]
    fn sprint_is_faster_than_running() {
        let mut s = open_ground();
        let top = run(&mut s, 96, Buttons::SPRINT);
        assert!((top - SPRINT_SPEED).abs() < 0.05, "sprint {top}");
        let mut s = open_ground();
        let top = run(&mut s, 96, Buttons::SPRINT | Buttons::FIRE);
        assert!(top < MAX_SPEED + 0.05, "firing cancels sprint: {top}");
    }

    #[test]
    fn slide_boosts_then_ends() {
        let mut s = open_ground();
        run(&mut s, 64, Buttons::SPRINT);
        let before = s.horizontal_speed();
        s = step(&s, &cmd(1, Buttons::SPRINT | Buttons::CROUCH), true, 1.0);
        assert!(s.sliding());
        assert!(
            s.horizontal_speed() > before + SLIDE_BOOST * 0.8,
            "boost {}",
            s.horizontal_speed()
        );
        assert_eq!(s.eye_height(), SLIDE_EYE_HEIGHT);
        // Holding the button: slide lasts SLIDE_TIME, then you stand up.
        run(
            &mut s,
            (SLIDE_TIME / DT) as usize + 2,
            Buttons::SPRINT | Buttons::CROUCH,
        );
        assert!(!s.sliding());
        // A fresh press while still on cooldown does nothing.
        assert!(s.slide_cooldown > 0.0);
        s = step(&s, &cmd(1, Buttons::SPRINT), true, 1.0);
        s = step(&s, &cmd(1, Buttons::SPRINT | Buttons::CROUCH), true, 1.0);
        assert!(!s.sliding());
    }

    #[test]
    fn slide_needs_speed() {
        let mut s = open_ground();
        s = step(&s, &cmd(0, Buttons::CROUCH), true, 1.0);
        assert!(!s.sliding());
    }

    #[test]
    fn crouch_is_slow_and_needs_headroom_to_stand() {
        let mut s = open_ground();
        let top = run(&mut s, 96, Buttons::CROUCH);
        assert!(s.crouched);
        assert!(
            (top - MAX_SPEED * CROUCH_SPEED_FACTOR).abs() < 0.05,
            "crouch {top}"
        );
        assert_eq!(s.eye_height(), CROUCH_EYE_HEIGHT);
        s = step(&s, &cmd(0, 0), true, 1.0);
        assert!(!s.crouched, "stands up in the open");
    }

    #[test]
    fn walks_up_stairs_onto_the_platform() {
        // South of the site B stairs, walking toward -Z.
        let mut s = MoveState {
            pos: Vec3::new(21.5, 0.0, -20.0),
            on_ground: true,
            ..Default::default()
        };
        for _ in 0..200 {
            s = step(&s, &cmd(1, 0), true, 1.0);
            if s.pos.z < -25.0 {
                break;
            }
        }
        assert!(s.on_ground);
        assert_eq!(s.pos.y, 1.0, "on the platform at z {}", s.pos.z);
    }

    #[test]
    fn walks_up_and_down_a_ramp() {
        let mut s = MoveState {
            pos: Vec3::new(-27.0, 0.0, -3.0),
            on_ground: true,
            ..Default::default()
        };
        for _ in 0..96 {
            s = step(&s, &cmd(1, 0), true, 1.0);
            assert!(
                s.on_ground || s.pos.y > 0.9,
                "stays grounded on the ramp at {:?}",
                s.pos
            );
        }
        assert_eq!(s.pos.y, 1.0);
        // Turn around and walk back down without leaving the ground.
        let back = |f| InputCmd {
            yaw: core::f32::consts::PI,
            ..cmd(f, 0)
        };
        for _ in 0..96 {
            s = step(&s, &back(1), true, 1.0);
            assert!(s.on_ground, "airborne going down at {:?}", s.pos);
        }
        assert_eq!(s.pos.y, 0.0);
    }

    #[test]
    fn frozen_players_do_not_move() {
        let mut s = MoveState {
            pos: Vec3::new(0.0, 0.0, 26.0),
            on_ground: true,
            ..Default::default()
        };
        for _ in 0..64 {
            s = step(&s, &cmd(1, Buttons::JUMP), false, 1.0);
        }
        assert_eq!(s.pos, Vec3::new(0.0, 0.0, 26.0));
    }
}
