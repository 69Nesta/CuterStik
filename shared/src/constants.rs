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
/// Height where the head hitbox starts.
pub const HEAD_START: f32 = 1.45;
pub const HEAD_HALF_WIDTH: f32 = 0.2;

// --- Movement (Source-style) --------------------------------------------
pub const GRAVITY: f32 = 20.0;
pub const MAX_SPEED: f32 = 6.25;
pub const WALK_SPEED_FACTOR: f32 = 0.52;
pub const GROUND_ACCEL: f32 = 5.5;
pub const AIR_ACCEL: f32 = 12.0;
/// Max wish speed in the air; low value is what makes air-strafing work.
pub const AIR_SPEED_CAP: f32 = 0.76;
pub const FRICTION: f32 = 5.2;
pub const STOP_SPEED: f32 = 2.0;
/// Discrete apex at 64 Hz ≈ 1.28 m: clears 1.0–1.2 m crates, not 1.5 m+.
pub const JUMP_SPEED: f32 = 7.3;
pub const MAX_FALL_SPEED: f32 = 40.0;

// --- Weapon (single rifle for now) ----------------------------------------
pub const MAG_SIZE: u8 = 30;
pub const FIRE_INTERVAL: f32 = 0.1;
pub const RELOAD_TIME: f32 = 2.5;
pub const BODY_DAMAGE: u8 = 30;
pub const HEAD_DAMAGE: u8 = 120;
pub const MAX_RANGE: f32 = 200.0;
pub const MAX_HEALTH: u8 = 100;

// --- Rounds ---------------------------------------------------------------
pub const FREEZE_TIME: f32 = 3.0;
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
