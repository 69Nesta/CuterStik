// First-person rifle. Rendered by drei's <Hud> in its own scene after the
// world, with a cleared depth buffer, so it never clips into walls.
import { Hud, Outlines, PerspectiveCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { useHud } from '../game/store'
import { world } from '../game/world'
import { INK, getCharacterMaterials, toon } from './materials'

const metal = toon({ color: '#454b59' })
const dark = toon({ color: '#2b2f3a' })
const flashMat = new THREE.MeshBasicMaterial({ color: '#ffe27a' })

const REST = new THREE.Vector3(0.22, -0.2, -0.45)

function Rifle() {
  const gun = useRef<THREE.Group>(null)
  const flash = useRef<THREE.Mesh>(null)
  const bob = useRef(0)
  const team = useHud((s) => s.myTeam)
  const m = getCharacterMaterials(team)

  useFrame((_, delta) => {
    const g = gun.current
    if (!g) return
    const me = world.me
    const visible = !!me?.alive
    g.visible = visible
    if (!visible) return

    world.recoil = Math.max(0, world.recoil - delta * 6)
    const speed = world.sim?.horizontal_speed() ?? 0
    const grounded = world.sim?.on_ground() ?? true
    bob.current += delta * speed * 1.6
    const bobAmt = grounded ? Math.min(speed / 6, 1) : 0

    const reloading = useHud.getState().reloading
    const target = reloading ? 1 : 0
    g.userData.reload = THREE.MathUtils.damp(g.userData.reload ?? 0, target, 10, delta)
    const r = g.userData.reload as number

    g.position.set(
      REST.x + Math.sin(bob.current) * 0.012 * bobAmt,
      REST.y - Math.abs(Math.cos(bob.current)) * 0.01 * bobAmt - r * 0.25,
      REST.z + world.recoil * 0.06,
    )
    g.rotation.set(world.recoil * 0.12 - r * 0.6, 0, r * 0.3)

    if (flash.current) flash.current.visible = performance.now() - world.muzzleFlashAt < 40
  })

  return (
    <group ref={gun}>
      <mesh position={[0, 0, -0.1]} material={metal}>
        <boxGeometry args={[0.06, 0.09, 0.55]} />
        <Outlines thickness={0.004} color={INK} />
      </mesh>
      <mesh position={[0, 0.0, -0.44]} rotation-x={Math.PI / 2} material={dark}>
        <cylinderGeometry args={[0.014, 0.014, 0.16, 10]} />
      </mesh>
      <mesh position={[0, 0.003, -0.53]} material={m.gunAccent}>
        <boxGeometry args={[0.04, 0.04, 0.06]} />
        <Outlines thickness={0.003} color={INK} />
      </mesh>
      <mesh position={[0, -0.09, -0.05]} rotation-x={0.25} material={dark}>
        <boxGeometry args={[0.045, 0.14, 0.07]} />
      </mesh>
      <mesh position={[0, -0.08, 0.17]} material={m.body}>
        <boxGeometry args={[0.055, 0.12, 0.2]} />
        <Outlines thickness={0.004} color={INK} />
      </mesh>
      <mesh position={[0, 0.07, -0.05]} material={dark}>
        <boxGeometry args={[0.02, 0.04, 0.12]} />
      </mesh>
      <mesh ref={flash} position={[0, 0, -0.62]} visible={false} material={flashMat}>
        <icosahedronGeometry args={[0.05, 0]} />
      </mesh>
    </group>
  )
}

export function ViewModel() {
  return (
    <Hud renderPriority={1}>
      <PerspectiveCamera makeDefault fov={68} near={0.01} far={10} position={[0, 0, 0]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[1, 2, 1]} intensity={1.8} />
      <Rifle />
    </Hud>
  )
}
