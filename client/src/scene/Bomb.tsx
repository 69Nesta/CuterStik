// The bomb when it isn't on someone's back: lying on the ground, or planted
// with a blinking light and a beep that speeds up as the timer runs out.
// Also draws the explosion.
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { C } from '../wasm'
import { sfx } from '../game/audio'
import { world } from '../game/world'

const caseMat = new THREE.MeshStandardMaterial({ color: '#3b3226', roughness: 0.8 })
const panelMat = new THREE.MeshStandardMaterial({ color: '#1d2130', roughness: 0.4 })
const ledMat = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 0 })
const blastMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, depthWrite: false })

const EXPLOSION_MS = 1400

/** Seconds between beeps for the time left on the bomb. */
function beepInterval(left: number) {
  if (left > 20) return 1
  if (left > 10) return 0.6
  if (left > 5) return 0.35
  return 0.18
}

export function Bomb() {
  const root = useRef<THREE.Group>(null)
  const light = useRef<THREE.PointLight>(null)
  const blast = useRef<THREE.Mesh>(null)
  const blastLight = useRef<THREE.PointLight>(null)
  const nextBeep = useRef(0)

  useFrame((state) => {
    const g = root.current
    const b = world.latest?.bomb
    const now = performance.now()
    if (g && light.current) {
      let pos = null
      let planted = false
      let left = 0
      if (b && typeof b === 'object') {
        if ('Dropped' in b) pos = b.Dropped.pos
        else if ('Planted' in b) {
          pos = b.Planted.pos
          planted = true
          left = b.Planted.left
        } else if ('Defused' in b) pos = b.Defused.pos
      }
      g.visible = !!pos
      if (pos) {
        g.position.set(pos.x, pos.y, pos.z)
        // Dropped: slowly spins so it catches the eye.
        g.rotation.y = planted ? 0.4 : state.clock.elapsedTime * 1.2
      }
      let lit = 0
      if (planted && pos) {
        const t = now / 1000
        if (t >= nextBeep.current) {
          nextBeep.current = t + beepInterval(left)
          sfx.bombBeep(pos)
        }
        // Light flashes for a moment on each beep.
        lit = nextBeep.current - t > beepInterval(left) - 0.12 ? 1 : 0
      } else {
        nextBeep.current = 0
      }
      ledMat.emissiveIntensity = planted ? 0.6 + lit * 3 : 0
      light.current.intensity = lit * 6
    }

    // Explosion: a fireball that grows and fades, with a flash of light.
    const ex = world.explosions[world.explosions.length - 1]
    const age = ex ? now - ex.born : Infinity
    if (blast.current && blastLight.current) {
      const on = age < EXPLOSION_MS
      blast.current.visible = on
      blastLight.current.intensity = on ? 400 * (1 - age / EXPLOSION_MS) : 0
      if (on && ex) {
        const k = age / EXPLOSION_MS
        blast.current.position.set(ex.pos.x, ex.pos.y + 1, ex.pos.z)
        blastLight.current.position.set(ex.pos.x, ex.pos.y + 3, ex.pos.z)
        blast.current.scale.setScalar(1 + Math.sqrt(k) * C.bomb_radius * 0.7)
        blastMat.opacity = 0.85 * (1 - k)
        blastMat.color.setHSL(0.08 - k * 0.06, 1, 0.6 - k * 0.3)
      }
    }
    if (world.explosions.length && age > EXPLOSION_MS) world.explosions = []
  })

  return (
    <>
      <group ref={root} visible={false}>
        <mesh position={[0, 0.09, 0]} material={caseMat} castShadow>
          <boxGeometry args={[0.42, 0.18, 0.3]} />
        </mesh>
        <mesh position={[0, 0.185, 0.02]} material={panelMat}>
          <boxGeometry args={[0.26, 0.012, 0.16]} />
        </mesh>
        <mesh position={[0.1, 0.195, -0.08]} material={ledMat}>
          <boxGeometry args={[0.05, 0.02, 0.05]} />
        </mesh>
        <pointLight ref={light} position={[0, 0.5, 0]} color="#ff3b30" distance={5} intensity={0} />
      </group>
      <mesh ref={blast} visible={false} material={blastMat}>
        <icosahedronGeometry args={[1, 2]} />
      </mesh>
      <pointLight ref={blastLight} color="#ffb347" distance={40} intensity={0} />
    </>
  )
}
