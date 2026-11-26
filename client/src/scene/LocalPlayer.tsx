// Drives the local player: samples input at the server tick rate, predicts
// movement and weapons with the shared Rust code, sends inputs, and places
// the camera.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { C, WEAPONS, raycastMap } from '../wasm'
import { attachInput, sampleInput } from '../game/input'
import { addTracer, noteInputSent, viewTick, world } from '../game/world'
import { VIEW_TIME_SCALE, type Arsenal, type WeaponId } from '../net/protocol'
import { useSettings } from '../game/settings'
import { setListener, sfx } from '../game/audio'

const BASE_FOV = 80
const SCOPED_FOV = 28
/** Extra FOV at full sprint / slide speed: sells the speed boost. */
const SPEED_FOV = 10
/** Share of the recoil pattern the camera follows (the rest is in the
 *  bullets only, so the crosshair stays readable). */
const VIEW_PUNCH = 0.45
/** Meters between footsteps at run speed. */
const STRIDE = 2.3
/** Below this speed you're walking or crouching: silent, like in CS. */
const QUIET_SPEED = 3.6

// Where the camera sits while waiting to spawn (mid-round join).
const OVERVIEW = { x: 0, y: 22, z: 34, pitch: -0.6, yaw: 0 }

const shotBuf = new Float32Array(6)
const kick = new Float32Array(2)

export function LocalPlayer() {
  const camera = useThree((s) => s.camera)
  const acc = useRef(0)
  const renderPos = useRef(new Float32Array(3))
  const eye = useRef(C.eye_height)
  const camY = useRef<number | null>(null)
  const roll = useRef(0)
  const stepDist = useRef(0)
  const wasGrounded = useRef(true)
  const fallSpeed = useRef(0)
  const lastPos = useRef<THREE.Vector3 | null>(null)

  useEffect(() => attachInput(), [])

  useFrame((_, delta) => {
    const sim = world.sim
    const snap = world.latest
    const me = world.me
    if (!sim || !snap) return

    const phase = snap.phase
    const canAct = phase !== 'Freeze' && !(typeof phase === 'object' && 'MatchEnd' in phase)

    acc.current += Math.min(delta, 0.25)
    while (acc.current >= C.dt) {
      acc.current -= C.dt
      if (!me || !me.alive) continue

      const { forward, right, buttons } = sampleInput()
      const tick = viewTick(C.dt * 1000)
      const viewTime = tick === null ? 0 : Math.max(0, Math.floor(tick * VIEW_TIME_SCALE))
      const before = world.arsenal
      const bytes = sim.tick(forward, right, buttons, world.yaw, world.pitch, canAct, viewTime)
      world.send?.(bytes)
      noteInputSent()

      const weapon = sim.take_shot(shotBuf) as WeaponId | null
      if (weapon) onLocalShot(weapon)
      world.arsenal = sim.arsenal() as Arsenal
      weaponSounds(before, world.arsenal)
    }

    if (me && me.spawn_id > 0) {
      sim.render_pos(acc.current / C.dt, renderPos.current)
      const [x, y, z] = renderPos.current
      const grounded = sim.on_ground()
      // Ease the eye toward the predicted height so crouching dips smoothly.
      eye.current = THREE.MathUtils.damp(eye.current, sim.eye_height(), 14, delta)
      // Smooth small steps (stairs, ramps, landings) on the ground.
      const target = y + eye.current
      if (camY.current === null || !grounded || Math.abs(target - camY.current) > 0.6) {
        camY.current = target
      } else {
        camY.current = THREE.MathUtils.damp(camY.current, target, 28, delta)
      }
      camera.position.set(x, camY.current, z)

      // Slight roll while sliding, plus the view punch from recoil.
      roll.current = THREE.MathUtils.damp(roll.current, sim.sliding() ? 0.06 : 0, 10, delta)
      sim.view_kick(kick)
      camera.rotation.set(
        world.pitch + kick[0] * VIEW_PUNCH,
        world.yaw + kick[1] * VIEW_PUNCH,
        roll.current,
        'YXZ',
      )

      const cam = camera as THREE.PerspectiveCamera
      const { speedFov } = useSettings.getState()
      let fov = BASE_FOV
      if (sim.zoomed()) {
        fov = SCOPED_FOV
      } else if (speedFov) {
        const over = Math.max(0, sim.horizontal_speed() - C.max_speed) / (C.sprint_speed - C.max_speed)
        fov += SPEED_FOV * Math.min(over, 1.4)
      }
      if (Math.abs(cam.fov - fov) > 0.01) {
        // Scope snaps in; speed FOV eases.
        cam.fov = Math.abs(cam.fov - fov) > 20 ? fov : THREE.MathUtils.damp(cam.fov, fov, 6, delta)
        cam.updateProjectionMatrix()
      }

      footsteps(x, y, z, grounded, delta)
      setListener(x, camY.current, z, world.yaw)
    } else {
      camY.current = null
      lastPos.current = null
      camera.position.set(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z)
      camera.rotation.set(OVERVIEW.pitch, OVERVIEW.yaw, 0, 'YXZ')
      setListener(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z, OVERVIEW.yaw)
    }
  })

  function footsteps(x: number, y: number, z: number, grounded: boolean, delta: number) {
    const sim = world.sim!
    const prev = lastPos.current
    if (!prev) {
      lastPos.current = new THREE.Vector3(x, y, z)
      return
    }
    const moved = Math.hypot(x - prev.x, z - prev.z)
    if (!grounded) fallSpeed.current = Math.max(fallSpeed.current, (prev.y - y) / Math.max(delta, 1e-3))
    if (grounded && !wasGrounded.current && fallSpeed.current > 4) sfx.land(null)
    if (grounded) fallSpeed.current = 0
    wasGrounded.current = grounded
    prev.set(x, y, z)

    if (!grounded || sim.horizontal_speed() < QUIET_SPEED || sim.crouched()) return
    stepDist.current += moved
    if (stepDist.current > STRIDE) {
      stepDist.current = 0
      sfx.footstep(null)
    }
  }

  return null
}

/** Sounds for predicted weapon changes: reload start, weapon switch. */
function weaponSounds(before: Arsenal | null, after: Arsenal) {
  if (!before) return
  if (after.reload_left > 0 && before.reload_left === 0) {
    const gun = after.active === 'Primary' && after.primary ? after.primary : after.secondary
    sfx.reload(WEAPONS[gun.id].reload_time)
  }
  if (after.draw_left > before.draw_left + 0.01) sfx.draw()
}

function onLocalShot(weapon: WeaponId) {
  const [ox, oy, oz, dx, dy, dz] = shotBuf
  const dist = raycastMap(ox, oy, oz, dx, dy, dz, C.max_range)
  const to = { x: ox + dx * dist, y: oy + dy * dist, z: oz + dz * dist }
  // Start the tracer slightly below and right of the eye, near the muzzle.
  const from = {
    x: ox + Math.cos(world.yaw) * 0.18 + dx * 0.6,
    y: oy - 0.15 + dy * 0.6,
    z: oz - Math.sin(world.yaw) * 0.18 + dz * 0.6,
  }
  if (!world.arsenal?.zoomed) addTracer(from, to, true)
  else addTracer({ x: ox, y: oy - 0.05, z: oz }, to, true)
  world.recoil = Math.min(1, world.recoil + (weapon === 'Sniper' || weapon === 'HandCannon' ? 0.9 : 0.35))
  world.muzzleFlashAt = performance.now()
  sfx.shot(weapon, null)
}
