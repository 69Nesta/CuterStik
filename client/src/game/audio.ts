// Sound effects, synthesized with Web Audio: no asset files. Remote sounds
// are positioned in 3D around the listener (the local camera).
import type { Vec3, WeaponId } from '../net/protocol'
import { useSettings } from './settings'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null

/** Create the audio context. Call from a user gesture (click, key). */
export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.connect(ctx.destination)
    // One second of white noise, reused by every noisy sound.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    applyVolume()
    useSettings.subscribe(applyVolume)
  }
  if (ctx.state === 'suspended') void ctx.resume()
}

function applyVolume() {
  if (master) master.gain.value = useSettings.getState().volume
}

/** Ready context, or null while audio is locked or muted. */
function ready() {
  if (!ctx || !master || ctx.state !== 'running' || useSettings.getState().volume <= 0) return null
  return ctx
}

/** Output for a sound: straight to the master bus, or through a 3D panner. */
function out(c: AudioContext, at: Vec3 | null, gain = 1): AudioNode {
  const g = c.createGain()
  g.gain.value = gain
  if (!at) {
    g.connect(master!)
    return g
  }
  const p = new PannerNode(c, {
    panningModel: 'equalpower',
    distanceModel: 'inverse',
    refDistance: 4,
    rolloffFactor: 1.1,
    maxDistance: 120,
    positionX: at.x,
    positionY: at.y,
    positionZ: at.z,
  })
  g.connect(p).connect(master!)
  return g
}

/** Filtered noise burst with an exponential decay. */
function burst(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  opts: { type: BiquadFilterType; freq: number; q?: number; gain: number; decay: number; sweepTo?: number },
) {
  const src = c.createBufferSource()
  src.buffer = noise
  src.playbackRate.value = 0.8 + Math.random() * 0.4
  const f = c.createBiquadFilter()
  f.type = opts.type
  f.frequency.setValueAtTime(opts.freq, t)
  if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.decay)
  f.Q.value = opts.q ?? 0.8
  const g = c.createGain()
  g.gain.setValueAtTime(opts.gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay)
  src.connect(f).connect(g).connect(dest)
  src.start(t, Math.random() * 0.5)
  src.stop(t + opts.decay + 0.05)
}

/** Sine/triangle tone with a short attack and exponential release. */
function tone(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  opts: { freq: number; to?: number; gain: number; decay: number; type?: OscillatorType },
) {
  const o = c.createOscillator()
  o.type = opts.type ?? 'sine'
  o.frequency.setValueAtTime(opts.freq, t)
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.decay)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(opts.gain, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay)
  o.connect(g).connect(dest)
  o.start(t)
  o.stop(t + opts.decay + 0.05)
}

/** Per-weapon shot character: crack brightness, body length, low thump. */
const SHOT: Record<WeaponId, { freq: number; decay: number; thump: number; gain: number }> = {
  Pistol: { freq: 2600, decay: 0.12, thump: 140, gain: 0.55 },
  HandCannon: { freq: 1500, decay: 0.3, thump: 90, gain: 0.9 },
  Smg: { freq: 3200, decay: 0.09, thump: 160, gain: 0.45 },
  Rifle: { freq: 2000, decay: 0.18, thump: 110, gain: 0.7 },
  Sniper: { freq: 1100, decay: 0.6, thump: 60, gain: 1.0 },
}

export const sfx = {
  /** `at` null = your own shot. */
  shot(weapon: WeaponId, at: Vec3 | null) {
    const c = ready()
    if (!c) return
    const s = SHOT[weapon]
    const t = c.currentTime
    const dest = out(c, at, at ? 1.4 : 0.8)
    burst(c, dest, t, { type: 'bandpass', freq: s.freq, q: 0.6, gain: s.gain, decay: s.decay, sweepTo: s.freq * 0.35 })
    burst(c, dest, t, { type: 'lowpass', freq: 900, gain: s.gain * 0.8, decay: s.decay * 1.8 })
    tone(c, dest, t, { freq: s.thump, to: s.thump * 0.4, gain: s.gain * 0.9, decay: s.decay * 1.2 })
  },

  footstep(at: Vec3 | null) {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, at, at ? 0.9 : 0.35)
    burst(c, dest, t, { type: 'lowpass', freq: 600 + Math.random() * 500, gain: 0.5, decay: 0.07 })
    burst(c, dest, t + 0.015, { type: 'bandpass', freq: 2400, q: 1.5, gain: 0.08, decay: 0.04 })
  },

  land(at: Vec3 | null) {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, at, at ? 0.9 : 0.45)
    burst(c, dest, t, { type: 'lowpass', freq: 400, gain: 0.7, decay: 0.12 })
  },

  /** Mag out, then mag in near the end of the reload. */
  reload(duration: number) {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, null, 0.5)
    burst(c, dest, t + 0.15, { type: 'bandpass', freq: 1800, q: 4, gain: 0.5, decay: 0.05 })
    burst(c, dest, t + duration * 0.7, { type: 'bandpass', freq: 1300, q: 4, gain: 0.6, decay: 0.06 })
    burst(c, dest, t + duration * 0.9, { type: 'bandpass', freq: 2600, q: 5, gain: 0.5, decay: 0.04 })
  },

  draw() {
    const c = ready()
    if (!c) return
    burst(c, out(c, null, 0.4), c.currentTime, { type: 'bandpass', freq: 2200, q: 3, gain: 0.5, decay: 0.06 })
  },

  hit(headshot: boolean) {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, null, 0.5)
    if (headshot) {
      tone(c, dest, t, { freq: 1600, gain: 0.5, decay: 0.35 })
      tone(c, dest, t, { freq: 3200, gain: 0.15, decay: 0.25 })
    } else {
      tone(c, dest, t, { freq: 1100, gain: 0.35, decay: 0.06, type: 'triangle' })
    }
  },

  kill() {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, null, 0.45)
    tone(c, dest, t, { freq: 880, gain: 0.4, decay: 0.12, type: 'triangle' })
    tone(c, dest, t + 0.08, { freq: 1320, gain: 0.4, decay: 0.2, type: 'triangle' })
  },

  hurt() {
    const c = ready()
    if (!c) return
    burst(c, out(c, null, 0.5), c.currentTime, { type: 'lowpass', freq: 300, gain: 0.8, decay: 0.15 })
  },

  buy() {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, null, 0.35)
    tone(c, dest, t, { freq: 1200, gain: 0.4, decay: 0.08, type: 'square' })
    tone(c, dest, t + 0.07, { freq: 1800, gain: 0.3, decay: 0.12, type: 'square' })
  },

  bombBeep(at: Vec3) {
    const c = ready()
    if (!c) return
    tone(c, out(c, at, 1.2), c.currentTime, { freq: 2100, gain: 0.5, decay: 0.09, type: 'square' })
  },

  /** Rising chirp: planted. Falling: defused. */
  bombState(planted: boolean) {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, null, 0.5)
    const notes = planted ? [660, 880, 1320] : [1320, 990, 660]
    notes.forEach((f, i) => tone(c, dest, t + i * 0.1, { freq: f, gain: 0.4, decay: 0.14, type: 'triangle' }))
  },

  explosion(at: Vec3) {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, at, 3)
    burst(c, dest, t, { type: 'lowpass', freq: 3000, gain: 1, decay: 1.8, sweepTo: 80 })
    tone(c, dest, t, { freq: 70, to: 30, gain: 1, decay: 1.5 })
  },

  /** Short jingle: a round starts, you win, or you lose. */
  jingle(kind: 'start' | 'win' | 'lose') {
    const c = ready()
    if (!c) return
    const t = c.currentTime
    const dest = out(c, null, 0.3)
    const notes = kind === 'start' ? [523, 659, 784] : kind === 'win' ? [523, 659, 784, 1047] : [440, 415, 349]
    notes.forEach((f, i) => tone(c, dest, t + i * 0.12, { freq: f, gain: 0.35, decay: 0.3, type: 'triangle' }))
  },
}

/** Place the listener at the camera, facing along `yaw`. */
export function setListener(x: number, y: number, z: number, yaw: number) {
  if (!ctx) return
  const l = ctx.listener
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  if (l.positionX) {
    const t = ctx.currentTime
    l.positionX.setValueAtTime(x, t)
    l.positionY.setValueAtTime(y, t)
    l.positionZ.setValueAtTime(z, t)
    l.forwardX.setValueAtTime(fx, t)
    l.forwardY.setValueAtTime(0, t)
    l.forwardZ.setValueAtTime(fz, t)
    l.upX.setValueAtTime(0, t)
    l.upY.setValueAtTime(1, t)
    l.upZ.setValueAtTime(0, t)
  } else {
    // Firefox: deprecated setters only.
    l.setPosition(x, y, z)
    l.setOrientation(fx, 0, fz, 0, 1, 0)
  }
}
