// TypeScript view of shared/src/protocol.rs as produced by serde-wasm-bindgen
// (externally tagged enums, `None` -> undefined). Keep in sync with Rust.

export type PlayerId = number
export type RoomId = number
export type Team = 'T' | 'Ct'
export type Vec3 = { x: number; y: number; z: number }

export type GameMode = 'Elimination' | 'TeamDeathmatch' | 'Deathmatch'

export type MatchWinner = { Team: Team } | { Player: PlayerId } | 'Draw'

export type Phase =
  | 'Warmup'
  | 'Freeze'
  | 'Live'
  | { RoundEnd: { winner: Team } }
  | { MatchEnd: { winner: MatchWinner } }

export type PlayerInfo = { id: PlayerId; name: string; team: Team }

export type PlayerSnap = {
  id: PlayerId
  team: Team
  pos: Vec3
  vel: Vec3
  on_ground: boolean
  slide: number
  slide_cooldown: number
  slide_held: boolean
  yaw: number
  pitch: number
  health: number
  alive: boolean
  ammo: number
  reloading: boolean
  kills: number
  deaths: number
  spawn_id: number
}

export type GameEvent =
  | { Joined: PlayerInfo }
  | { Left: { id: PlayerId } }
  | { Shot: { shooter: PlayerId; from: Vec3; to: Vec3; hit?: PlayerId | null } }
  | { Kill: { killer: PlayerId; victim: PlayerId; headshot: boolean } }
  | { RoundStart: { round: number } }

export type Snapshot = {
  tick: number
  ack_seq: number
  phase: Phase
  phase_time_left: number
  round: number
  score_t: number
  score_ct: number
  players: PlayerSnap[]
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

export type Surface = 'Floor' | 'Wall' | 'Crate' | 'Platform'
export type MapBox = { bounds: { min: Vec3; max: Vec3 }; surface: Surface }

export type Constants = {
  tick_rate: number
  dt: number
  eye_height: number
  player_height: number
  player_half_width: number
  head_start: number
  mag_size: number
  fire_interval: number
  max_health: number
  max_speed: number
  sprint_speed: number
  slide_eye_height: number
  max_range: number
  rounds_to_win: number
  tdm_kill_limit: number
  dm_kill_limit: number
}

// Must match `Buttons` in protocol.rs.
export const Buttons = {
  JUMP: 1 << 0,
  FIRE: 1 << 1,
  RELOAD: 1 << 2,
  WALK: 1 << 3,
  SPRINT: 1 << 4,
  SLIDE: 1 << 5,
} as const

export const MODES: { id: GameMode; name: string; blurb: string }[] = [
  { id: 'Elimination', name: 'Elimination', blurb: 'One life per round. First to 7 rounds.' },
  { id: 'TeamDeathmatch', name: 'Team DM', blurb: 'Teams with respawns. First to 50 kills.' },
  { id: 'Deathmatch', name: 'Deathmatch', blurb: 'Free-for-all. First to 25 kills.' },
]
export const modeName = (m: GameMode) => MODES.find((x) => x.id === m)!.name
export const hasTeams = (m: GameMode) => m !== 'Deathmatch'

export const teamName = (t: Team) => (t === 'T' ? 'Attackers' : 'Defenders')
