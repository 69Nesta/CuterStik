// Lobby backdrop: your mannequin on a prototype-grid stage, wearing the
// colors of the side you picked.
import { ContactShadows, Outlines } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Team } from '../net/protocol'
import { Mannequin, type Pose } from '../scene/Mannequin'
import { INK, SURFACE_STYLE, getSurfaceMaterials, gridTexture } from '../scene/materials'

function Floor() {
  const material = useMemo(() => {
    const map = gridTexture({ ...SURFACE_STYLE.Floor, label: '4m' })
    map.repeat.set(10, 10)
    const mat = getSurfaceMaterials().Floor.clone()
    mat.map = map
    return mat
  }, [])
  return (
    <mesh rotation-x={-Math.PI / 2} material={material} receiveShadow>
      <planeGeometry args={[40, 40]} />
    </mesh>
  )
}

function Props() {
  const m = getSurfaceMaterials()
  const crate = (pos: [number, number, number], size: number, rot = 0) => (
    <mesh position={pos} rotation-y={rot} material={m.Crate} castShadow receiveShadow>
      <boxGeometry args={[size, size, size]} />
      <Outlines thickness={0.03} color={INK} />
    </mesh>
  )
  return (
    <group>
      {crate([-1.7, 0.5, -1.2], 1, 0.3)}
      {crate([-1.55, 1.35, -1.25], 0.7, 0.7)}
      {crate([1.9, 0.4, -2.2], 0.8, -0.4)}
      <mesh position={[0.3, 1.5, -4]} material={m.Wall} castShadow receiveShadow>
        <boxGeometry args={[9, 3, 0.6]} />
        <Outlines thickness={0.04} color={INK} />
      </mesh>
      <mesh position={[2.6, 0.25, -0.2]} material={m.Platform} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.5, 1.6]} />
        <Outlines thickness={0.03} color={INK} />
      </mesh>
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
      onCreated={({ camera }) => camera.lookAt(1.6, 1, 0)}
    >
      <color attach="background" args={['#8fd3ff']} />
      <fog attach="fog" args={['#bfe6ff', 10, 26]} />
      <hemisphereLight args={['#eaf6ff', '#8a93a6', 1.5]} />
      <directionalLight
        position={[4, 7, 5]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-normalBias={0.02}
      />
      <group position={[0, 0, 0]}>
        <Hero team={team} />
      </group>
      <Props />
      <Floor />
      <ContactShadows position={[0, 0.01, 0]} scale={6} blur={2.4} opacity={0.35} far={2} />
    </Canvas>
  )
}
