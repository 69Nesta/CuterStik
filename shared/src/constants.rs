//! Gameplay constants shared by the server simulation and client prediction.
//! Units are meters and seconds.

/// Simulation ticks per second (server and client prediction).
pub const TICK_RATE: u32 = 64;
pub const DT: f32 = 1.0 / TICK_RATE as f32;

// --- Player body ---------------------------------------------------------
/// Half width of the player collision box (X and Z).
pub const PLAYER_HALF_WIDTH: f32 = 0.4;
/// Full height of the player collision box. Position is the feet center.
pub const PLAYER_HEIGHT: f32 = 1.8;
pub const EYE_HEIGHT: f32 = 1.64;
/// Height where the head hitbox starts (standing).
pub const HEAD_START: f32 = 1.45;
/// Collision height while crouched or sliding.
pub const CROUCH_HEIGHT: f32 = 1.3;
pub const CROUCH_EYE_HEIGHT: f32 = 1.12;
/// Ledges up to this tall are walked up (stairs, ramp steps).
pub const STEP_HEIGHT: f32 = 0.42;
pub const HEAD_HALF_WIDTH: f32 = 0.2;

// --- Movement (Source-style) --------------------------------------------
pub const GRAVITY: f32 = 20.0;
pub const MAX_SPEED: f32 = 6.25;
pub const WALK_SPEED_FACTOR: f32 = 0.52;
pub const CROUCH_SPEED_FACTOR: f32 = 0.42;
pub const GROUND_ACCEL: f32 = 5.5;
pub const AIR_ACCEL: f32 = 12.0;
/// Max wish speed in the air; low value is what makes air-strafing work.
pub const AIR_SPEED_CAP: f32 = 0.76;
pub const FRICTION: f32 = 5.2;
pub const STOP_SPEED: f32 = 2.0;
/// Discrete apex at 64 Hz ≈ 1.28 m: clears 1.0–1.2 m crates, not 1.5 m+.
pub const JUMP_SPEED: f32 = 7.3;
pub const MAX_FALL_SPEED: f32 = 40.0;

// --- Combat ---------------------------------------------------------------
/// Weapon stats live in `weapons.rs`.
pub const MAX_RANGE: f32 = 200.0;
pub const MAX_HEALTH: u8 = 100;
pub const MAX_ARMOR: u8 = 100;
/// Seconds to pull out a weapon after switching or buying.
pub const DRAW_TIME: f32 = 0.45;
/// How far back the server rewinds hitboxes to match what a shooter saw.
pub const MAX_REWIND: f32 = 0.4;

// --- Rounds ---------------------------------------------------------------
pub const FREEZE_TIME: f32 = 3.0;
/// Elimination freeze time is longer: it's when you shop.
pub const ELIM_FREEZE_TIME: f32 = 7.0;
pub const ROUND_TIME: f32 = 115.0;
pub const ROUND_END_TIME: f32 = 4.0;
/// Respawn delay while in warmup (not enough players for real rounds).
pub const WARMUP_RESPAWN: f32 = 2.0;
pub const MAX_PLAYERS_PER_ROOM: usize = 10;
pub const MAX_NAME_LEN: usize = 16;
pub const MAX_ROOM_NAME_LEN: usize = 24;
/// Upper bound on concurrently open rooms per server.
pub const MAX_ROOMS: usize = 32;

// --- Sprint / slide -----------------------------------------------------
/// Ground speed while sprinting forward (not firing, not walking).
pub const SPRINT_SPEED: f32 = 8.4;
/// Eye height while sliding: the camera and shot origin drop.
pub const SLIDE_EYE_HEIGHT: f32 = 1.05;
/// Must be moving at least this fast to start a slide.
pub const SLIDE_MIN_SPEED: f32 = 5.0;
/// Speed added along the current direction when a slide starts.
pub const SLIDE_BOOST: f32 = 3.0;
/// Slide start never pushes horizontal speed past this.
pub const SLIDE_MAX_SPEED: f32 = 11.5;
pub const SLIDE_TIME: f32 = 0.8;
/// From slide start until the next slide can boost again.
pub const SLIDE_COOLDOWN: f32 = 1.4;
/// Friction during a slide (normal ground friction is `FRICTION`).
pub const SLIDE_FRICTION: f32 = 0.9;
/// A slide ends early below this speed.
pub const SLIDE_END_SPEED: f32 = 3.0;

// --- Game modes -----------------------------------------------------------
/// Elimination: first team to this many rounds wins the match.
pub const ROUNDS_TO_WIN: u16 = 7;
pub const TDM_KILL_LIMIT: u16 = 50;
pub const TDM_TIME: f32 = 600.0;
pub const DM_KILL_LIMIT: u16 = 25;
pub const DM_TIME: f32 = 480.0;
/// Respawn delay in the deathmatch modes.
pub const RESPAWN_TIME: f32 = 2.5;
/// Damage immunity after a deathmatch respawn; firing ends it early.
pub const SPAWN_PROTECTION: f32 = 1.5;
/// Scoreboard time after a match is decided, before the next one starts.
pub const MATCH_END_TIME: f32 = 8.0;

// --- Economy (Elimination) ----------------------------------------------
pub const START_MONEY: u16 = 800;
pub const MAX_MONEY: u16 = 16000;
pub const WIN_REWARD: u16 = 3250;
/// Loss bonus grows with each consecutive lost round.
pub const LOSS_REWARD: u16 = 1400;
pub const LOSS_STEP: u16 = 500;
pub const LOSS_MAX: u16 = 3400;
/// Attackers' team bonus for a lost round where the bomb was planted.
pub const PLANT_TEAM_BONUS: u16 = 800;
/// Personal reward for planting or defusing.
pub const OBJECTIVE_REWARD: u16 = 300;
/// Buying stays open this long into the live round (inside your buy zone).
pub const BUY_TIME: f32 = 20.0;
pub const KEVLAR_PRICE: u16 = 650;
pub const KEVLAR_HELMET_PRICE: u16 = 1000;

// --- Bomb (Elimination) ---------------------------------------------------
pub const PLANT_TIME: f32 = 3.2;
pub const DEFUSE_TIME: f32 = 6.0;
pub const BOMB_TIMER: f32 = 40.0;
/// Horizontal reach for defusing and picking up a dropped bomb.
pub const DEFUSE_RANGE: f32 = 1.6;
pub const PICKUP_RANGE: f32 = 1.2;
/// Planting / defusing cancels above this horizontal speed.
pub const OBJECTIVE_MAX_SPEED: f32 = 1.0;
pub const BOMB_RADIUS: f32 = 14.0;
pub const BOMB_DAMAGE: f32 = 220.0;
