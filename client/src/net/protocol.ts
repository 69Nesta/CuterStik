// TypeScript view of shared/src/protocol.rs as produced by serde-wasm-bindgen
// (externally tagged enums, `None` -> undefined). Keep in sync with Rust.

export type PlayerId = number
export type RoomId = number
export type Team = 'T' | 'Ct'
export type Vec3 = { x: number; y: number; z: number }

export type GameMode = 'Elimination' | 'TeamDeathmatch' | 'Deathmatch'

export type WeaponId = 'Pistol' | 'HandCannon' | 'Smg' | 'Rifle' | 'Sniper'
export type Slot = 'Primary' | 'Secondary'
export type BuyItem = { Weapon: WeaponId } | 'Kevlar' | 'KevlarHelmet'
export type RoundEndReason = 'Eliminated' | 'BombExploded' | 'BombDefused' | 'TimeUp'

export type MatchWinner = { Team: Team } | { Player: PlayerId } | 'Draw'

export type Phase =
  | 'Warmup'
  | 'Freeze'
  | 'Live'
  | { RoundEnd: { winner: Team; reason: RoundEndReason } }
  | { MatchEnd: { winner: MatchWinner } }

export type PlayerInfo = { id: PlayerId; name: string; team: Team }

/** shared::movement::MoveState */
export type MoveState = {
  pos: Vec3
  vel: Vec3
  on_ground: boolean
  slide: number
  slide_cooldown: number
  slide_held: boolean
  crouched: boolean
}

export type Gun = { id: WeaponId; ammo: number; reserve: number }

/** shared::weapons::Arsenal */
export type Arsenal = {
  primary?: Gun | null
  secondary: Gun
  active: Slot
  fire_cooldown: number
  reload_left: number
  draw_left: number
  spray: number
  fire_held: boolean
  zoomed: boolean
}

export type PlayerSnap = {
  id: PlayerId
  team: Team
  mv: MoveState
  yaw: number
  pitch: number
  health: number
  armor: number
  helmet: boolean
  alive: boolean
  weapon: WeaponId
  reloading: boolean
  zoomed: boolean
  money: number
  kills: number
  deaths: number
  spawn_id: number
}

export type BombState =
  | 'Inactive'
  | { Carried: { by: PlayerId; planting: number } }
  | { Dropped: { pos: Vec3 } }
  | {
      Planted: {
        pos: Vec3
        site: number
        left: number
        defuser?: PlayerId | null
        defusing: number
      }
    }
  | { Exploded: { pos: Vec3 } }
  | { Defused: { pos: Vec3 } }

export type GameEvent =
  | { Joined: PlayerInfo }
  | { Left: { id: PlayerId } }
  | { Shot: { shooter: PlayerId; weapon: WeaponId; from: Vec3; to: Vec3; hit?: PlayerId | null } }
  | { Kill: { killer: PlayerId; victim: PlayerId; headshot: boolean; weapon?: WeaponId | null } }
  | { RoundStart: { round: number } }
  | { BombPlanted: { by: PlayerId; site: number } }
  | { BombDefused: { by: PlayerId } }
  | { BombExploded: { pos: Vec3 } }
  | { BombPickedUp: { by: PlayerId } }
  | { BombDropped: { pos: Vec3 } }
  | { Bought: { by: PlayerId; item: BuyItem } }

export type Snapshot = {
  tick: number
  ack_seq: number
  phase: Phase
  phase_time_left: number
  round: number
  score_t: number
  score_ct: number
  buy_open: boolean
  bomb: BombState
  players: PlayerSnap[]
  you?: Arsenal | null
  events: GameEvent[]
}

export type ServerMsg =
  | {
      Welcome: {
        your_id: PlayerId
        room_id: RoomId
        room_name: string
        mode: GameMode
        tick_rate: number
        roster: PlayerInfo[]
      }
    }
  | { Snapshot: Snapshot }
  | { Rejected: { reason: string } }

export type RoomRequest =
  | { Quick: { mode: GameMode } }
  | { Join: RoomId }
  | { Create: { name: string; mode: GameMode } }

/** One row of `GET /api/rooms` (server/src/rooms.rs `RoomSummary`). */
export type RoomSummary = {
  id: RoomId
  name: string
  mode: GameMode
  players: number
  max_players: number
  phase: 'Warmup' | 'Live'
  round: number
  score_t: number
  score_ct: number
}

export type Surface = 'Floor' | 'Wall' | 'Crate' | 'Platform' | 'Stairs'
export type MapBox = { bounds: { min: Vec3; max: Vec3 }; surface: Surface }
export type Ramp = { bounds: { min: Vec3; max: Vec3 }; rise: 'PosX' | 'NegX' | 'PosZ' | 'NegZ' }
export type BombSite = { label: string; x: number; z: number; radius: number }
export type BuyZone = { team: Team; min_x: number; min_z: number; max_x: number; max_z: number }

/** shared::weapons::WeaponSpec */
export type WeaponSpec = {
  id: WeaponId
  name: string
  slot: Slot
  price: number
  mag: number
  reserve: number
  fire_interval: number
  reload_time: number
  auto: boolean
  body_damage: number
  head_damage: number
  armor_pen: number
  spread: number
  scoped_spread?: number | null
  kill_reward: number
  speed: number
}

export type Constants = {
  tick_rate: number
  dt: number
  eye_height: number
  player_height: number
  crouch_height: number
  crouch_eye_height: number
  player_half_width: number
  head_start: number
  max_health: number
  max_armor: number
  draw_time: number
  slide_cooldown: number
  max_speed: number
  sprint_speed: number
  slide_eye_height: number
  max_range: number
  rounds_to_win: number
  tdm_kill_limit: number
  dm_kill_limit: number
  start_money: number
  buy_time: number
  kevlar_price: number
  kevlar_helmet_price: number
  plant_time: number
  defuse_time: number
  bomb_timer: number
  bomb_radius: number
  defuse_range: number
}

// Must match `Buttons` in protocol.rs.
export const Buttons = {
  JUMP: 1 << 0,
  FIRE: 1 << 1,
  RELOAD: 1 << 2,
  WALK: 1 << 3,
  SPRINT: 1 << 4,
  /** Crouch; pressed at speed it slides. */
  CROUCH: 1 << 5,
  USE: 1 << 6,
  ZOOM: 1 << 7,
  SLOT1: 1 << 8,
  SLOT2: 1 << 9,
} as const

/** Fixed-point scale of `InputCmd::view_time` (1/16 ticks). */
export const VIEW_TIME_SCALE = 16

export const MODES: { id: GameMode; name: string; blurb: string }[] = [
  { id: 'Elimination', name: 'Elimination', blurb: 'Bomb, economy, one life per round. First to 7.' },
  { id: 'TeamDeathmatch', name: 'Team DM', blurb: 'Teams with respawns. First to 50 kills.' },
  { id: 'Deathmatch', name: 'Deathmatch', blurb: 'Free-for-all. First to 25 kills.' },
]
export const modeName = (m: GameMode) => MODES.find((x) => x.id === m)!.name
export const hasTeams = (m: GameMode) => m !== 'Deathmatch'

export const teamName = (t: Team) => (t === 'T' ? 'Attackers' : 'Defenders')
