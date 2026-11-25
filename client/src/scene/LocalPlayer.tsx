// Drives the local player: samples input at the server tick rate, predicts
// movement with the shared Rust code, sends inputs, and places the camera.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { C, raycastMap } from '../wasm'
import { attachInput, sampleInput } from '../game/input'
import { addTracer, noteInputSent, world } from '../game/world'
import { Buttons } from '../net/protocol'
import { useSettings } from '../game/settings'

const BASE_FOV = 80
/** Extra FOV at full sprint / slide speed: sells the speed boost. */
const SPEED_FOV = 10

// Where the camera sits while waiting to spawn (mid-round join).
const OVERVIEW = { x: 0, y: 22, z: 34, pitch: -0.6, yaw: 0 }

export function LocalPlayer() {
  const camera = useThree((s) => s.camera)
  const acc = useRef(0)
  const fireCooldown = useRef(0)
  const renderPos = useRef(new Float32Array(3))
  const eye = useRef(C.eye_height)
  const roll = useRef(0)

  useEffect(() => attachInput(), [])

  useFrame((_, delta) => {
    const sim = world.sim
    const snap = world.latest
    const me = world.me
    if (!sim || !snap) return

    const canAct = snap.phase !== 'Freeze'

    acc.current += Math.min(delta, 0.25)
    while (acc.current >= C.dt) {
      acc.current -= C.dt
      fireCooldown.current = Math.max(0, fireCooldown.current - C.dt)
      if (!me || !me.alive) continue

      const { forward, right, buttons } = sampleInput()

      // Cosmetic fire prediction; the server decides what was hit.
      if (
        buttons & Buttons.FIRE &&
        canAct &&
        fireCooldown.current <= 0 &&
        me.ammo > 0 &&
        !me.reloading
      ) {
        fireCooldown.current = C.fire_interval
        fireLocalTracer()
      }

      const bytes = sim.tick(forward, right, buttons, world.yaw, world.pitch, canAct)
      world.send?.(bytes)
      noteInputSent()
    }

    if (me && me.spawn_id > 0) {
      sim.render_pos(acc.current / C.dt, renderPos.current)
      const [x, y, z] = renderPos.current
      // Ease the eye toward the predicted height so a slide dips smoothly.
      eye.current = THREE.MathUtils.damp(eye.current, sim.eye_height(), 14, delta)
      camera.position.set(x, y + eye.current, z)
      // Slight roll while sliding, FOV kick past normal run speed.
      roll.current = THREE.MathUtils.damp(roll.current, sim.sliding() ? 0.06 : 0, 10, delta)
      camera.rotation.set(world.pitch, world.yaw, roll.current, 'YXZ')
      const over = Math.max(0, sim.horizontal_speed() - C.max_speed) / (C.sprint_speed - C.max_speed)
      const cam = camera as THREE.PerspectiveCamera
      const { speedFov } = useSettings.getState()
      const fov = BASE_FOV + (speedFov ? SPEED_FOV * Math.min(over, 1.4) : 0)
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = THREE.MathUtils.damp(cam.fov, fov, 6, delta)
        cam.updateProjectionMatrix()
      }
    } else {
      camera.position.set(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z)
      camera.rotation.set(OVERVIEW.pitch, OVERVIEW.yaw, 0, 'YXZ')
    }
  })

  return null
}

function fireLocalTracer() {
  if (!world.sim) return
  const pos = new Float32Array(3)
  world.sim.render_pos(1, pos)
  const cp = Math.cos(world.pitch)
  const dir = {
    x: -Math.sin(world.yaw) * cp,
    y: Math.sin(world.pitch),
    z: -Math.cos(world.yaw) * cp,
  }
  const eye = { x: pos[0], y: pos[1] + world.sim.eye_height(), z: pos[2] }
  const dist = raycastMap(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, C.max_range)
  const to = { x: eye.x + dir.x * dist, y: eye.y + dir.y * dist, z: eye.z + dir.z * dist }
  // Start the tracer slightly below and right of the eye, near the muzzle.
  const from = {
    x: eye.x + Math.cos(world.yaw) * 0.18 + dir.x * 0.6,
    y: eye.y - 0.15 + dir.y * 0.6,
    z: eye.z - Math.sin(world.yaw) * 0.18 + dir.z * 0.6,
  }
  addTracer(from, to, true)
  world.recoil = Math.min(1, world.recoil + 0.35)
  world.muzzleFlashAt = performance.now()
}
