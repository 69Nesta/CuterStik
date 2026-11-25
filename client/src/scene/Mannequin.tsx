// The player character: a capsule agent in a dark undersuit with
// team-colored armor and a glowing visor. Proportions follow the server
// hitboxes: body up to C.head_start, head above it.
import { useFrame } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { getCharacterMaterials, type Look } from './materials'

export type Pose = {
  /** Horizontal speed in m/s, drives the walk cycle. */
  speed: number
  pitch: number
  onGround: boolean
  sliding: boolean
}

export function Mannequin({ look, pose }: { look: Look; pose: RefObject<Pose> }) {
  const m = getCharacterMaterials(look)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const aim = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const cycle = useRef(0)
  const slide = useRef(0)

  useFrame((state, delta) => {
    const { speed, pitch, onGround, sliding } = pose.current
    // Sprinting lengthens the stride past the normal run.
    const stride = Math.min(speed / 6, 1.35)
    cycle.current += delta * (2 + speed * 1.7)
    slide.current = THREE.MathUtils.damp(slide.current, sliding ? 1 : 0, 16, delta)
    const s = slide.current
    const swing = onGround ? Math.sin(cycle.current) * 0.7 * stride : 0.5
    // Slide: both legs kicked forward, body leaned back and dropped.
    if (legL.current) legL.current.rotation.x = THREE.MathUtils.lerp(swing, 1.35, s)
    if (legR.current) legR.current.rotation.x = THREE.MathUtils.lerp(onGround ? -swing : -0.3, 1.1, s)
    if (body.current) {
      body.current.position.y = -0.55 * s
      body.current.rotation.x = 0.35 * s
    }
    // Idle breathing when standing still, bounce when running.
    const t = state.clock.elapsedTime
    const bob = onGround ? Math.abs(Math.sin(cycle.current)) * 0.04 * stride * (1 - s) + Math.sin(t * 2) * 0.008 : 0
    if (torso.current) torso.current.position.y = bob
    if (aim.current) aim.current.rotation.x = pitch
    if (head.current) head.current.rotation.x = pitch * 0.6
  })

  return (
    <group ref={body}>
      {[legL, legR].map((ref, i) => (
        <group key={i} ref={ref} position={[i === 0 ? -0.13 : 0.13, 0.82, 0]}>
          <mesh position={[0, -0.37, 0]} material={m.joint} castShadow>
            <capsuleGeometry args={[0.11, 0.5, 4, 12]} />
          </mesh>
        </group>
      ))}

      <group ref={torso}>
        <mesh position={[0, 1.1, 0]} material={m.body} castShadow>
          <capsuleGeometry args={[0.25, 0.28, 6, 16]} />
        </mesh>

        <group ref={head} position={[0, 1.45, 0]}>
          <mesh position={[0, 0.19, 0]} material={m.body} castShadow>
            <sphereGeometry args={[0.18, 20, 14]} />
          </mesh>
          {/* Visor shows where the player is facing. */}
          <mesh position={[0, 0.21, -0.15]} rotation-z={Math.PI / 2} material={m.visor}>
            <capsuleGeometry args={[0.05, 0.16, 4, 10]} />
          </mesh>
        </group>

        <group ref={aim} position={[0, 1.36, 0]}>
          {/* Right arm along the stock, left arm out to the handguard. */}
          <mesh position={[0.24, -0.06, -0.16]} rotation-x={Math.PI / 2.3} material={m.body} castShadow>
            <capsuleGeometry args={[0.075, 0.26, 4, 10]} />
          </mesh>
          <mesh
            position={[-0.06, -0.1, -0.3]}
            rotation={[Math.PI / 2.2, 0, -0.9]}
            material={m.body}
            castShadow
          >
            <capsuleGeometry args={[0.07, 0.36, 4, 10]} />
          </mesh>
          <group position={[0.12, -0.12, -0.42]}>
            <mesh material={m.gun} castShadow>
              <boxGeometry args={[0.08, 0.12, 0.66]} />
            </mesh>
            <mesh position={[0, -0.1, 0.12]} rotation-x={0.3} material={m.gun}>
              <boxGeometry args={[0.06, 0.14, 0.08]} />
            </mesh>
            <mesh position={[0, 0.01, -0.38]} material={m.gunAccent}>
              <boxGeometry args={[0.06, 0.06, 0.12]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}
