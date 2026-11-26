// WebSocket session: handshake, snapshot handling, prediction reconcile.
import { BOMB_SITES, BUY_ZONES, C, LocalSim, WEAPONS, decodeServer, encodeBuy, encodeHello } from '../wasm'
import { addTracer, noteAck, resetWorld, world } from '../game/world'
import { patchHud, useHud, type BombHud, type KillfeedEntry, type PhaseLabel } from '../game/store'
import { sfx } from '../game/audio'
import { onBuy } from '../game/input'
import {
  teamName,
  type Arsenal,
  type BuyItem,
  type GameEvent,
  type MatchWinner,
  type PlayerId,
  type PlayerInfo,
  type PlayerSnap,
  type RoundEndReason,
  type RoomRequest,
  type Snapshot,
  type Team,
} from './protocol'

const BUFFER_MS = 1000
const KILLFEED_MS = 6000

let ws: WebSocket | null = null
const roster = new Map<PlayerId, PlayerInfo>()
let killKey = 0

// wasm-bindgen returns copies backed by a plain ArrayBuffer.
const asBuffer = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>

export function startSession(name: string, room: RoomRequest, team: Team | null) {
  stopSession()
  localStorage.setItem('name', name)
  useHud.setState({ status: 'connecting', error: null, name, room: null })

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const socket = new WebSocket(`${proto}://${location.host}/ws`)
  socket.binaryType = 'arraybuffer'
  ws = socket

  socket.onopen = () => socket.send(asBuffer(encodeHello(name, room, team)))
  socket.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) onMessage(new Uint8Array(e.data))
  }
  socket.onclose = () => {
    if (ws !== socket) return // replaced by a newer session
    ws = null
    resetWorld()
    useHud.setState((s) => ({
      status: 'menu',
      error: s.error ?? 'Disconnected from server',
    }))
  }
  world.send = (bytes) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(asBuffer(bytes))
  }
}

export function buy(item: BuyItem) {
  world.send?.(asBuffer(encodeBuy(item)))
}
onBuy(buy)

export function stopSession() {
  const socket = ws
  ws = null
  socket?.close()
  resetWorld()
  roster.clear()
}

function onMessage(bytes: Uint8Array) {
  let msg
  try {
    msg = decodeServer(bytes)
  } catch (err) {
    console.error('bad server frame', err)
    return
  }

  if ('Welcome' in msg) {
    const { your_id, room_id, room_name, mode, roster: players } = msg.Welcome
    world.myId = your_id
    world.sim = new LocalSim(your_id)
    roster.clear()
    for (const p of players) roster.set(p.id, p)
    useHud.setState({
      status: 'playing',
      myId: your_id,
      room: { id: room_id, name: room_name, mode },
      killfeed: [],
    })
  } else if ('Snapshot' in msg) {
    onSnapshot(msg.Snapshot)
  } else if ('Rejected' in msg) {
    useHud.setState({ error: msg.Rejected.reason })
  }
}

function onSnapshot(snap: Snapshot) {
  const now = performance.now()
  world.latest = snap
  noteAck(snap.ack_seq)

  // Clock sync for interpolation: track the lowest observed offset, slowly
  // relaxing upward so a temporary lag spike doesn't stick forever.
  const serverMs = snap.tick * C.dt * 1000
  const sample = now - serverMs
  world.clockOffset =
    world.clockOffset === null || sample < world.clockOffset
      ? sample
      : world.clockOffset + (sample - world.clockOffset) * 0.002

  const players = new Map(snap.players.map((p) => [p.id, p]))
  world.buffer.push({ serverMs, players })
  while (world.buffer.length > 2 && serverMs - world.buffer[0].serverMs > BUFFER_MS) {
    world.buffer.shift()
  }

  for (const ev of snap.events) onEvent(ev, now)

  const me = world.myId !== null ? players.get(world.myId) : undefined
  world.me = me ?? null
  if (me && world.sim && snap.you) {
    if (me.spawn_id !== world.lastSpawnId) {
      world.lastSpawnId = me.spawn_id
      world.sim.teleport(me.mv, snap.you)
      world.yaw = me.yaw
      world.pitch = me.pitch
    } else if (me.alive) {
      world.sim.reconcile(snap.ack_seq, me.mv, snap.you)
    }
    world.arsenal = world.sim.arsenal() as Arsenal
  }

  updateHud(snap, now)
}

function onEvent(ev: GameEvent, now: number) {
  const me = world.myId
  if ('Joined' in ev) {
    roster.set(ev.Joined.id, ev.Joined)
  } else if ('Left' in ev) {
    roster.delete(ev.Left.id)
  } else if ('Shot' in ev) {
    const { shooter, weapon, from, to, hit } = ev.Shot
    // Our own tracers and sounds are played as we fire (predicted).
    if (shooter !== me) {
      addTracer(from, to, false)
      sfx.shot(weapon, from)
      if (hit === me) sfx.hurt()
    } else if (hit != null) {
      useHud.setState({ hitmarkerAt: now })
      // The headshot ding comes with the kill event when it kills.
      sfx.hit(false)
    }
  } else if ('Kill' in ev) {
    const { killer, victim, headshot, weapon } = ev.Kill
    const k = roster.get(killer)
    const v = roster.get(victim)
    const entry: KillfeedEntry = {
      key: killKey++,
      killer: k?.name ?? '?',
      killerTeam: k?.team,
      victim: v?.name ?? '?',
      victimTeam: v?.team,
      headshot,
      weapon: weapon ? WEAPONS[weapon].name : null,
      at: now,
    }
    useHud.setState((s) => ({ killfeed: [...s.killfeed, entry].slice(-5) }))
    if (killer === me && victim !== me) {
      sfx.kill()
      if (headshot) sfx.hit(true)
    }
  } else if ('RoundStart' in ev) {
    showBanner(`Round ${ev.RoundStart.round}`)
    sfx.jingle('start')
  } else if ('BombPlanted' in ev) {
    const site = BOMB_SITES[ev.BombPlanted.site]?.label ?? '?'
    showBanner(`Bomb planted at ${site}`, 3000)
    sfx.bombState(true)
  } else if ('BombDefused' in ev) {
    sfx.bombState(false)
  } else if ('BombExploded' in ev) {
    world.explosions.push({ pos: ev.BombExploded.pos, born: now })
    sfx.explosion(ev.BombExploded.pos)
  } else if ('BombPickedUp' in ev) {
    if (ev.BombPickedUp.by === me) showBanner('You picked up the bomb', 2000)
  } else if ('BombDropped' in ev) {
    if (useHud.getState().myTeam === 'T') showBanner('The bomb was dropped', 2000)
  } else if ('Bought' in ev) {
    if (ev.Bought.by === me) sfx.buy()
  }
}

let bannerTimer: number | undefined
function showBanner(text: string, ms = 2500) {
  useHud.setState({ banner: text })
  clearTimeout(bannerTimer)
  bannerTimer = window.setTimeout(() => useHud.setState({ banner: null }), ms)
}

let lastScoreKey = ''
let lastRemoteKey = ''
let lastPhase: PhaseLabel = 'Warmup'

function updateHud(snap: Snapshot, now: number) {
  const me = world.me
  const p = snap.phase
  const phase: PhaseLabel =
    typeof p === 'string' ? p : 'RoundEnd' in p ? 'RoundEnd' : 'MatchEnd'
  const winner = typeof p === 'object' && 'RoundEnd' in p ? p.RoundEnd.winner : null

  if (phase !== lastPhase) {
    if (typeof p === 'object' && 'RoundEnd' in p) {
      showBanner(roundBanner(p.RoundEnd.winner, p.RoundEnd.reason), 3500)
      if (me) sfx.jingle(me.team === p.RoundEnd.winner ? 'win' : 'lose')
    } else if (typeof p === 'object' && 'MatchEnd' in p) {
      showBanner(matchBanner(p.MatchEnd.winner), 7000)
    }
  }
  lastPhase = phase

  const arsenal = world.arsenal
  const gun =
    arsenal && (arsenal.active === 'Primary' && arsenal.primary ? arsenal.primary : arsenal.secondary)
  patchHud({
    myTeam: me?.team ?? null,
    health: me?.health ?? 0,
    armor: me?.armor ?? 0,
    helmet: me?.helmet ?? false,
    money: me?.money ?? 0,
    weapon: gun?.id ?? 'Pistol',
    ammo: gun?.ammo ?? 0,
    reserve: gun?.reserve ?? 0,
    reloading: (arsenal?.reload_left ?? 0) > 0,
    zoomed: arsenal?.zoomed ?? false,
    canBuy: snap.buy_open && inBuyZone(me ?? undefined),
    bomb: bombHud(snap, me ?? undefined),
    alive: me?.alive ?? false,
    spawned: (me?.spawn_id ?? 0) > 0,
    phase,
    winner,
    timeLeft: Math.ceil(snap.phase_time_left),
    myKills: me?.kills ?? 0,
    topKills: snap.players.reduce((m, pl) => Math.max(m, pl.kills), 0),
    round: snap.round,
    scoreT: snap.score_t,
    scoreCt: snap.score_ct,
  })

  // Lists only change occasionally; compare a cheap key before updating.
  const remoteIds = snap.players.filter((p) => p.id !== world.myId).map((p) => p.id)
  const remoteKey = remoteIds.join(',')
  if (remoteKey !== lastRemoteKey) {
    lastRemoteKey = remoteKey
    useHud.setState({ remoteIds })
  }

  const rows = snap.players.map((p) => ({
    id: p.id,
    name: roster.get(p.id)?.name ?? `#${p.id}`,
    team: p.team,
    kills: p.kills,
    deaths: p.deaths,
    alive: p.alive,
  }))
  const scoreKey = JSON.stringify(rows)
  if (scoreKey !== lastScoreKey) {
    lastScoreKey = scoreKey
    useHud.setState({ scoreboard: rows })
  }

  const feed = useHud.getState().killfeed
  if (feed.length && now - feed[0].at > KILLFEED_MS) {
    useHud.setState({ killfeed: feed.filter((k) => now - k.at <= KILLFEED_MS) })
  }
}

function roundBanner(winner: Team, reason: RoundEndReason) {
  const side = winner === 'T' ? 'Attackers win' : 'Defenders win'
  switch (reason) {
    case 'BombExploded':
      return `Bomb exploded. ${side}`
    case 'BombDefused':
      return `Bomb defused. ${side}`
    case 'TimeUp':
      return `Time's up. ${side}`
    default:
      return `${side} the round`
  }
}

/** Buying needs you inside your team's zone (anywhere in respawn modes). */
function inBuyZone(me: PlayerSnap | undefined) {
  if (!me?.alive) return false
  const mode = useHud.getState().room?.mode
  if (mode !== 'Elimination' || useHud.getState().phase === 'Warmup') return true
  return inOwnBuyZone(me)
}

function inOwnBuyZone(me: PlayerSnap) {
  const { x, z } = me.mv.pos
  return BUY_ZONES.some(
    (b) => b.team === me.team && x >= b.min_x && x <= b.max_x && z >= b.min_z && z <= b.max_z,
  )
}

function bombHud(snap: Snapshot, me: PlayerSnap | undefined): BombHud {
  const b = snap.bomb
  if (typeof b === 'string' || !me) return { kind: 'none' }
  if ('Carried' in b) {
    if (b.Carried.by !== me.id) return { kind: 'none' }
    const { x, z } = me.mv.pos
    const inSite = BOMB_SITES.some((s) => Math.hypot(x - s.x, z - s.z) <= s.radius)
    return { kind: 'carrying', inSite, planting: b.Carried.planting }
  }
  if ('Dropped' in b) return me.team === 'T' ? { kind: 'dropped' } : { kind: 'none' }
  if ('Planted' in b) {
    const { site, left, defuser, defusing } = b.Planted
    return {
      kind: 'planted',
      site: BOMB_SITES[site]?.label ?? '?',
      left,
      defusing,
      defusingMe: defuser === me.id,
    }
  }
  return { kind: 'none' }
}

function matchBanner(w: MatchWinner) {
  if (w === 'Draw') return 'Match drawn'
  if ('Team' in w) return `${teamName(w.Team)} win the match`
  return w.Player === world.myId ? 'You win the match!' : `${playerName(w.Player)} wins the match`
}

export function playerName(id: PlayerId) {
  return roster.get(id)?.name ?? `#${id}`
}

// Close the socket when Vite hot-reloads this module.
if (import.meta.hot) {
  import.meta.hot.dispose(() => stopSession())
}
