// End-to-end check (needs the server running): two bots using the client's wasm module against the
// real server. Verifies handshake, freeze time, prediction parity,
// headshot kill, round win and next-round respawn.
import { readFileSync } from 'node:fs'
const pkg = new URL("../src/shared-wasm", import.meta.url).pathname
const wasm = await import(`${pkg}/shared.js`)
await wasm.default({ module_or_path: readFileSync(`${pkg}/shared_bg.wasm`) })
const C = wasm.constants()
const WS_URL = process.env.WS_URL ?? 'ws://localhost:8080/ws'

function bot(name) {
  const b = { name, id: null, snap: null, me: null, events: [], sim: new wasm.LocalSim(), spawn: -1, maxErr: 0 }
  b.ws = new WebSocket(WS_URL)
  b.ws.binaryType = 'arraybuffer'
  b.ready = new Promise((res) => {
    b.ws.onopen = () => b.ws.send(wasm.encode_hello(name, { Quick: { mode: 'Elimination' } }, null))
    b.ws.onmessage = (e) => {
      const msg = wasm.decode_server(new Uint8Array(e.data))
      if (msg.Welcome) { b.id = msg.Welcome.your_id; res() }
      if (msg.Rejected) throw new Error(msg.Rejected.reason)
      if (msg.Snapshot) {
        const s = msg.Snapshot
        b.snap = s
        b.events.push(...s.events)
        b.me = s.players.find((p) => p.id === b.id)
        if (!b.me) return
        if (b.me.spawn_id !== b.spawn) {
          b.spawn = b.me.spawn_id
          b.sim.teleport(b.me.pos.x, b.me.pos.y, b.me.pos.z)
        } else if (b.me.alive) {
          // Prediction error before reconcile, for inputs the server acked:
          // only meaningful when nothing is pending.
          b.sim.reconcile(s.ack_seq, b.me.pos.x, b.me.pos.y, b.me.pos.z, b.me.vel.x, b.me.vel.y, b.me.vel.z, b.me.on_ground, b.me.slide, b.me.slide_cooldown, b.me.slide_held)
        }
      }
    }
  })
  b.input = (fwd, right, buttons, yaw, pitch) => {
    const canMove = b.snap?.phase !== 'Freeze'
    b.ws.send(b.sim.tick(fwd, right, buttons, yaw, pitch, canMove))
  }
  return b
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tickMs = 1000 / C.tick_rate
const phaseName = (p) => (typeof p === 'string' ? p : Object.keys(p)[0])
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1 }

async function run(ticks, fn) { for (let i = 0; i < ticks; i++) { fn(i); await sleep(tickMs) } }
async function until(pred, timeout = 8000) {
  const t0 = Date.now()
  while (!pred()) { if (Date.now() - t0 > timeout) return false; await sleep(10) }
  return true
}

const a = bot('alpha'), b = bot('bravo')
await Promise.all([a.ready, b.ready])
await until(() => a.me && b.me)
check(a.me.team !== b.me.team, `bots on opposite teams (${a.me.team} / ${b.me.team})`)
const t = a.me.team === 'T' ? a : b
const ct = t === a ? b : a

check(await until(() => phaseName(t.snap.phase) === 'Freeze'), 'round starts with freeze time once both teams have a player')
const frozenAt = { ...t.me.pos }
await run(40, () => { t.input(1, 0, 0, 0, 0); ct.input(0, 0, 0, Math.PI, 0) })
await sleep(100)
check(Math.hypot(t.me.pos.x - frozenAt.x, t.me.pos.z - frozenAt.z) < 1e-4, 'cannot move during freeze time')

check(await until(() => phaseName(t.snap.phase) === 'Live'), 'freeze -> live')

// CT strafes out from behind its cover wall toward +x (right dir at yaw PI is -x).
await run(110, () => { ct.input(0, -1, 0, Math.PI, 0); t.input(0, 0, 0, 0, 0) })
await sleep(150)
const predicted = new Float32Array(3)
ct.sim.render_pos(1, predicted)
const err = Math.hypot(predicted[0] - ct.me.pos.x, predicted[1] - ct.me.pos.y, predicted[2] - ct.me.pos.z)
check(err < 1e-3, `wasm prediction matches native server after 110 ticks (error ${err.toExponential(2)} m, pending ${ct.sim.pending_count()})`)
console.log('      CT at', ct.me.pos)

// T aims at the CT's head and fires one shot.
const eye = { x: t.me.pos.x, y: t.me.pos.y + C.eye_height, z: t.me.pos.z }
const head = { x: ct.me.pos.x, y: ct.me.pos.y + 1.62, z: ct.me.pos.z }
const dx = head.x - eye.x, dy = head.y - eye.y, dz = head.z - eye.z
const yaw = Math.atan2(-dx, -dz)
const pitch = Math.atan2(dy, Math.hypot(dx, dz))
await run(3, (i) => { t.input(0, 0, i === 0 ? 2 : 0, yaw, pitch); ct.input(0, 0, 0, Math.PI, 0) })

check(await until(() => t.events.some((e) => e.Kill)), 'kill event received')
const kill = t.events.find((e) => e.Kill)?.Kill
check(kill?.headshot === true && kill.killer === t.id && kill.victim === ct.id, 'one-tap headshot credited to the shooter')
check(await until(() => phaseName(t.snap.phase) === 'RoundEnd'), 'round ends when a team is eliminated')
check(t.snap.phase.RoundEnd?.winner === 'T' && t.snap.score_t === 1, `attackers win, score ${t.snap.score_t}-${t.snap.score_ct}`)
check(t.me.ammo === C.mag_size - 1, `ammo ${t.me.ammo}/${C.mag_size}`)

const spawnBefore = ct.me.spawn_id
check(await until(() => phaseName(t.snap.phase) === 'Freeze' && t.snap.round === 2, 7000), 'round 2 starts')
check(ct.me.alive && ct.me.health === 100 && ct.me.spawn_id > spawnBefore, 'dead player respawns at next round')

a.ws.close(); b.ws.close()
await sleep(100)
process.exit()
