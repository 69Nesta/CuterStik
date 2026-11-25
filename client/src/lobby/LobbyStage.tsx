// Lobby backdrop: your agent on a small courtyard set built from the same
// painted surfaces as the map, wearing the colors of the side you picked.
import { ContactShadows } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Surface, Team } from '../net/protocol'
import { Mannequin, type Pose } from '../scene/Mannequin'
import { LIGHTING, getSurfaceMaterials, surfaceGeometry } from '../scene/materials'
import { Sky } from '../scene/Sky'

const SUN: [number, number, number] = [-6, 8, 6]

/** A box from its world-space center and size, so world UVs line up. */
function Block({ surface, at, size, rot = 0 }: {
  surface: Surface
  at: [number, number, number]
  size: [number, number, number]
  rot?: number
}) {
  const geometry = useMemo(() => {
    const half = new THREE.Vector3(...size).multiplyScalar(0.5)
    const c = new THREE.Vector3(...at)
    return surfaceGeometry(c.clone().sub(half), c.clone().add(half), surface)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, at.join(), size.join()])
  return (
    <mesh
      geometry={geometry}
      material={getSurfaceMaterials()[surface]}
      position={at}
      rotation-y={rot}
      castShadow={surface !== 'Floor'}
      receiveShadow
    />
  )
}

function Courtyard() {
  return (
    <group>
      <Block surface="Floor" at={[0, -0.5, 0]} size={[40, 1, 40]} />
      <Block surface="Wall" at={[0.3, 2, -4]} size={[10, 4, 0.6]} />
      <Block surface="Wall" at={[-4.4, 2, -1.5]} size={[0.6, 4, 4.4]} />
      <Block surface="Crate" at={[-1.7, 0.5, -1.2]} size={[1, 1, 1]} rot={0.3} />
      <Block surface="Crate" at={[-1.55, 1.35, -1.25]} size={[0.7, 0.7, 0.7]} rot={0.7} />
      <Block surface="Crate" at={[1.9, 0.5, -2.4]} size={[1, 1, 1]} rot={-0.4} />
      <Block surface="Platform" at={[2.8, 0.25, -0.2]} size={[1.6, 0.5, 1.6]} />
    </group>
  )
}

function Hero({ team }: { team: Team | null }) {
  const turntable = useRef<THREE.Group>(null)
  const pose = useRef<Pose>({ speed: 0, pitch: 0, onGround: true, sliding: false })
  const hop = useRef(0)
  const lastTeam = useRef(team)

  useFrame((state, delta) => {
    const g = turntable.current
    if (!g) return
    // Little hop whenever the side changes, so the swap registers.
    if (lastTeam.current !== team) {
      lastTeam.current = team
      hop.current = 1
    }
    hop.current = Math.max(0, hop.current - delta * 3)
    g.position.y = Math.sin(hop.current * Math.PI) * 0.35
    pose.current.onGround = hop.current === 0
    const t = state.clock.elapsedTime
    g.rotation.y = Math.PI - 0.15 + Math.sin(t * 0.4) * 0.3
    pose.current.pitch = Math.sin(t * 0.7) * 0.08
  })

  return (
    <group ref={turntable}>
      <Mannequin look={team} pose={pose} />
    </group>
  )
}

export function LobbyStage({ team }: { team: Team | null }) {
  return (
    <Canvas
      className="lobby-stage"
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 32, position: [-1.4, 1.7, 6.2] }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onCreated={({ camera }) => camera.lookAt(1.6, 1, 0)}
    >
      <Sky sunDirection={SUN} />
      <fog attach="fog" args={[LIGHTING.horizon, 12, 30]} />
      <hemisphereLight args={[LIGHTING.sky, LIGHTING.ground, 1.15]} />
      <directionalLight
        position={SUN}
        color={LIGHTING.sun}
        intensity={3.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-normalBias={0.02}
      />
      <group position={[0, 0, 0]}>
        <Hero team={team} />
      </group>
      <Courtyard />
      <ContactShadows position={[0, 0.01, 0]} scale={6} blur={2.4} opacity={0.35} far={2} />
    </Canvas>
  )
}
