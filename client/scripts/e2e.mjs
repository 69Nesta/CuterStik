// End-to-end check (needs the server running): two bots using the client's
// wasm module against the real server. Verifies handshake, buying, freeze
// time, the bomb carrier, prediction parity (movement and weapons), a kill
// with lag-compensated hitscan, round win and next-round respawn.
import { readFileSync } from 'node:fs'
const pkg = new URL("../src/shared-wasm", import.meta.url).pathname
const wasm = await import(`${pkg}/shared.js`)
await wasm.default({ module_or_path: readFileSync(`${pkg}/shared_bg.wasm`) })
const C = wasm.constants()
const WS_URL = process.env.WS_URL ?? 'ws://localhost:8080/ws'
const FIRE = 1 << 1

function bot(name) {
  const b = { name, id: null, snap: null, me: null, you: null, events: [], sim: null, spawn: -1 }
  b.ws = new WebSocket(WS_URL)
  b.ws.binaryType = 'arraybuffer'
  b.ready = new Promise((res) => {
    b.ws.onopen = () => b.ws.send(wasm.encode_hello(name, { Quick: { mode: 'Elimination' } }, null))
    b.ws.onmessage = (e) => {
      const msg = wasm.decode_server(new Uint8Array(e.data))
      if (msg.Welcome) {
        b.id = msg.Welcome.your_id
        b.sim = new wasm.LocalSim(b.id)
        res()
      }
      if (msg.Rejected) throw new Error(msg.Rejected.reason)
      if (msg.Snapshot) {
        const s = msg.Snapshot
        b.snap = s
        b.you = s.you
        b.events.push(...s.events)
        b.me = s.players.find((p) => p.id === b.id)
        if (!b.me || !s.you) return
        if (b.me.spawn_id !== b.spawn) {
          b.spawn = b.me.spawn_id
          b.sim.teleport(b.me.mv, s.you)
        } else if (b.me.alive) {
          b.sim.reconcile(s.ack_seq, b.me.mv, s.you)
        }
      }
    }
  })
  b.input = (fwd, right, buttons, yaw, pitch) => {
    const canAct = b.snap?.phase !== 'Freeze'
    // The bots "see" the latest snapshot, so that's the time they shoot at.
    const viewTime = (b.snap?.tick ?? 0) * 16
    b.ws.send(b.sim.tick(fwd, right, buttons, yaw, pitch, canAct, viewTime))
  }
  b.buy = (item) => b.ws.send(wasm.encode_buy(item))
  return b
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tickMs = 1000 / C.tick_rate
const phaseName = (p) => (typeof p === 'string' ? p : Object.keys(p)[0])
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1 }

async function run(ticks, fn) { for (let i = 0; i < ticks; i++) { fn(i); await sleep(tickMs) } }
async function until(pred, timeout = 10000) {
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
check(t.snap.bomb.Carried?.by === t.id, 'the attacker starts with the bomb')
check(t.you.secondary.id === 'Pistol' && !t.you.primary && t.me.money === C.start_money, `pistol round, $${t.me.money}`)

ct.buy('Kevlar')
await until(() => ct.me.armor > 0, 2000)
check(ct.me.armor === 100 && ct.me.money === C.start_money - C.kevlar_price, `defender bought kevlar ($${ct.me.money} left)`)

const frozenAt = { ...t.me.mv.pos }
await run(40, () => { t.input(1, 0, 0, 0, 0); ct.input(0, 0, 0, Math.PI, 0) })
await sleep(100)
check(Math.hypot(t.me.mv.pos.x - frozenAt.x, t.me.mv.pos.z - frozenAt.z) < 1e-4, 'cannot move during freeze time')

check(await until(() => phaseName(t.snap.phase) === 'Live'), 'freeze -> live')

// CT strafes out from behind its cover wall toward +x (right dir at yaw PI is -x).
await run(110, () => { ct.input(0, -1, 0, Math.PI, 0); t.input(0, 0, 0, 0, 0) })
await sleep(150)
const predicted = new Float32Array(3)
ct.sim.render_pos(1, predicted)
const pos = ct.me.mv.pos
const err = Math.hypot(predicted[0] - pos.x, predicted[1] - pos.y, predicted[2] - pos.z)
check(err < 1e-3, `wasm prediction matches native server after 110 ticks (error ${err.toExponential(2)} m, pending ${ct.sim.pending_count()})`)
console.log('      CT at', pos)

// T aims at the CT's head and taps the pistol until the CT goes down.
const eye = { x: t.me.mv.pos.x, y: t.me.mv.pos.y + C.eye_height, z: t.me.mv.pos.z }
const head = { x: pos.x, y: pos.y + 1.62, z: pos.z }
const dx = head.x - eye.x, dy = head.y - eye.y, dz = head.z - eye.z
const yaw = Math.atan2(-dx, -dz)
const pitch = Math.atan2(dy, Math.hypot(dx, dz))
let shots = 0
for (let i = 0; i < 12 && !t.events.some((e) => e.Kill); i++) {
  // Semi-auto: one press per shot, then wait out the fire interval.
  await run(12, (k) => { t.input(0, 0, k === 0 ? FIRE : 0, yaw, pitch); ct.input(0, 0, 0, Math.PI, 0) })
  shots++
  await sleep(60)
}

check(await until(() => t.events.some((e) => e.Kill)), `kill event received after ${shots} shot(s)`)
const kill = t.events.find((e) => e.Kill)?.Kill
check(kill?.killer === t.id && kill.victim === ct.id && kill.weapon === 'Pistol', `kill credited to the shooter (headshot: ${kill?.headshot})`)
check(await until(() => phaseName(t.snap.phase) === 'RoundEnd'), 'round ends when a team is eliminated')
check(t.snap.phase.RoundEnd?.winner === 'T' && t.snap.score_t === 1, `attackers win, score ${t.snap.score_t}-${t.snap.score_ct}`)
check(t.you.secondary.ammo === 12 - shots, `predicted and server ammo agree: ${t.you.secondary.ammo}/12`)
check(t.me.money > C.start_money, `attacker got paid: $${t.me.money}`)

const spawnBefore = ct.me.spawn_id
check(await until(() => phaseName(t.snap.phase) === 'Freeze' && t.snap.round === 2, 9000), 'round 2 starts')
check(ct.me.alive && ct.me.health === 100 && ct.me.spawn_id > spawnBefore, 'dead player respawns at next round')
check(ct.me.armor === 0, 'dying lost the kevlar')

a.ws.close(); b.ws.close()
await sleep(100)
process.exit()
