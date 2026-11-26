// Mutable game state read by the scene every frame. Written by the network
// session; never put in React state.
import type { LocalSim } from '../wasm'
import type { Arsenal, PlayerId, PlayerSnap, Snapshot, Vec3 } from '../net/protocol'

/** Remote players are drawn this far in the past (interpolation). */
export const INTERP_DELAY_MS = 100

export type BufferedSnapshot = {
  /** Server time in ms (tick * dt). */
  serverMs: number
  players: Map<PlayerId, PlayerSnap>
}

export type Tracer = { from: Vec3; to: Vec3; born: number; local: boolean }

export const world = {
  sim: null as LocalSim | null,
  myId: null as PlayerId | null,
  latest: null as Snapshot | null,
  me: null as PlayerSnap | null,
  lastSpawnId: -1,
  /** Predicted weapons of the local player (ammo, timers, weapon out). */
  arsenal: null as Arsenal | null,

  /** View angles, owned by the client (mouse look). */
  yaw: 0,
  pitch: 0,

  /** Remote player interpolation buffer, oldest first. */
  buffer: [] as BufferedSnapshot[],
  /** Smoothed (receive time - server time) offset in ms. */
  clockOffset: null as number | null,

  tracers: [] as Tracer[],
  /** Bomb explosions: position and start time, for the effect. */
  explosions: [] as { pos: Vec3; born: number }[],
  /** Visual recoil kick, decays to 0. */
  recoil: 0,
  muzzleFlashAt: 0,

  send: null as ((bytes: Uint8Array) => void) | null,

  /** Input seq numbers, mirrored from LocalSim (it starts at 1). */
  inputSeq: 0,
  /** Send time of each unacknowledged input, oldest first. */
  sentAt: new Map<number, number>(),
  /** Smoothed input round trip in ms: send to server acknowledgement. */
  ping: null as number | null,
}

export function resetWorld() {
  world.sim?.free()
  world.sim = null
  world.myId = null
  world.latest = null
  world.me = null
  world.lastSpawnId = -1
  world.arsenal = null
  world.explosions = []
  world.buffer = []
  world.clockOffset = null
  world.tracers = []
  world.recoil = 0
  world.send = null
  world.inputSeq = 0
  world.sentAt.clear()
  world.ping = null
}

/** Call after every `sim.tick` that was sent. */
export function noteInputSent() {
  world.inputSeq++
  world.sentAt.set(world.inputSeq, performance.now())
  // Never acknowledged (e.g. dropped connection): don't grow forever.
  if (world.sentAt.size > 512) world.sentAt.delete(world.sentAt.keys().next().value!)
}

/**
 * Snapshot acknowledged inputs up to `ack`. The time since we sent that
 * input is the round trip (plus up to one server tick of queueing).
 */
export function noteAck(ack: number) {
  const sent = world.sentAt.get(ack)
  if (sent !== undefined) {
    const rtt = performance.now() - sent
    world.ping = world.ping === null ? rtt : world.ping + (rtt - world.ping) * 0.1
  }
  for (const seq of world.sentAt.keys()) {
    if (seq > ack) break
    world.sentAt.delete(seq)
  }
}

export function addTracer(from: Vec3, to: Vec3, local: boolean) {
  world.tracers.push({ from, to, born: performance.now(), local })
  if (world.tracers.length > 64) world.tracers.shift()
}

/** Server time currently shown for remote players, in ticks (or null). */
export function viewTick(tickMs: number) {
  if (world.clockOffset === null) return null
  return (performance.now() - world.clockOffset - INTERP_DELAY_MS) / tickMs
}
