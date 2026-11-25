// Mutable game state read by the scene every frame. Written by the network
// session; never put in React state.
import type { LocalSim } from '../wasm'
import type { PlayerId, PlayerSnap, Snapshot, Vec3 } from '../net/protocol'

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

  /** View angles, owned by the client (mouse look). */
  yaw: 0,
  pitch: 0,

  /** Remote player interpolation buffer, oldest first. */
  buffer: [] as BufferedSnapshot[],
  /** Smoothed (receive time - server time) offset in ms. */
  clockOffset: null as number | null,

  tracers: [] as Tracer[],
  /** Visual recoil kick, decays to 0. */
  recoil: 0,
  muzzleFlashAt: 0,

  send: null as ((bytes: Uint8Array) => void) | null,
}

export function resetWorld() {
  world.sim?.free()
  world.sim = null
  world.myId = null
  world.latest = null
  world.me = null
  world.lastSpawnId = -1
  world.buffer = []
  world.clockOffset = null
  world.tracers = []
  world.recoil = 0
  world.send = null
}

export function addTracer(from: Vec3, to: Vec3, local: boolean) {
  world.tracers.push({ from, to, born: performance.now(), local })
  if (world.tracers.length > 64) world.tracers.shift()
}
