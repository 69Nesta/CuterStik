// React-facing UI state (HUD, menus). Per-frame game data lives in
// `world.ts` instead so the 64 Hz network stream doesn't re-render React.
import { create } from 'zustand'
import type { GameMode, PlayerId, RoomId, Team, WeaponId } from '../net/protocol'

export type KillfeedEntry = {
  key: number
  killer: string
  killerTeam?: Team
  victim: string
  victimTeam?: Team
  headshot: boolean
  /** Weapon name, or null for the bomb. */
  weapon: string | null
  at: number
}

/** What the local player's bomb HUD shows. */
export type BombHud =
  | { kind: 'none' }
  | { kind: 'carrying'; inSite: boolean; planting: number }
  | { kind: 'dropped' }
  | { kind: 'planted'; site: string; left: number; defusing: number; defusingMe: boolean }

export type ScoreRow = {
  id: PlayerId
  name: string
  team: Team
  kills: number
  deaths: number
  alive: boolean
}

export type PhaseLabel = 'Warmup' | 'Freeze' | 'Live' | 'RoundEnd' | 'MatchEnd'

export type HudState = {
  status: 'menu' | 'connecting' | 'playing'
  error: string | null
  name: string
  /** Side picked in the lobby; null = auto-balance. */
  teamPref: Team | null
  /** Mode picked in the lobby for quick play / new rooms. */
  modePref: GameMode
  room: { id: RoomId; name: string; mode: GameMode } | null

  myId: PlayerId | null
  myTeam: Team | null
  health: number
  armor: number
  helmet: boolean
  money: number
  weapon: WeaponId
  ammo: number
  reserve: number
  reloading: boolean
  zoomed: boolean
  canBuy: boolean
  bomb: BombHud
  alive: boolean
  spawned: boolean

  phase: PhaseLabel
  winner: Team | null
  /** Deathmatch: your kills and the best score in the room. */
  myKills: number
  topKills: number
  timeLeft: number
  round: number
  scoreT: number
  scoreCt: number

  remoteIds: PlayerId[]
  scoreboard: ScoreRow[]
  killfeed: KillfeedEntry[]
  hitmarkerAt: number
  banner: string | null

  locked: boolean
  showScores: boolean
  settingsOpen: boolean
  buyOpen: boolean
}

export const useHud = create<HudState>(() => ({
  status: 'menu',
  error: null,
  name: localStorage.getItem('name') ?? '',
  teamPref: (localStorage.getItem('teamPref') as Team | null) || null,
  modePref: (localStorage.getItem('modePref') as GameMode | null) || 'Elimination',
  room: null,

  myId: null,
  myTeam: null,
  health: 100,
  armor: 0,
  helmet: false,
  money: 0,
  weapon: 'Pistol',
  ammo: 0,
  reserve: 0,
  reloading: false,
  zoomed: false,
  canBuy: false,
  bomb: { kind: 'none' },
  alive: false,
  spawned: false,

  phase: 'Warmup',
  winner: null,
  myKills: 0,
  topKills: 0,
  timeLeft: 0,
  round: 0,
  scoreT: 0,
  scoreCt: 0,

  remoteIds: [],
  scoreboard: [],
  killfeed: [],
  hitmarkerAt: 0,
  banner: null,

  locked: false,
  showScores: false,
  settingsOpen: false,
  buyOpen: false,
}))

/** setState that skips the update when nothing actually changed. */
export function patchHud(partial: Partial<HudState>) {
  const state = useHud.getState()
  for (const key in partial) {
    const k = key as keyof HudState
    const a = state[k]
    const b = partial[k]
    const same =
      Object.is(a, b) ||
      (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))
    if (!same) {
      useHud.setState(partial)
      return
    }
  }
}
