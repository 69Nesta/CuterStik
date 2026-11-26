// First-person weapon. Rendered by drei's <Hud> in its own scene after the
// world, with a cleared depth buffer, so it never clips into walls.
import { Hud, PerspectiveCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { C } from '../wasm'
import { useHud } from '../game/store'
import { world } from '../game/world'
import { GUNS, GunModel } from './Guns'
import { LIGHTING, getCharacterMaterials } from './materials'

const flashMat = new THREE.MeshBasicMaterial({ color: '#ffe27a' })

/** Rest position per weapon class: pistols sit closer and higher. */
const REST = {
  rifle: new THREE.Vector3(0.22, -0.2, -0.45),
  pistol: new THREE.Vector3(0.2, -0.17, -0.38),
}

function Weapon() {
  const gun = useRef<THREE.Group>(null)
  const flash = useRef<THREE.Mesh>(null)
  const bob = useRef(0)
  const reload = useRef(0)
  const team = useHud((s) => s.myTeam)
  const weapon = useHud((s) => s.weapon)
  const m = getCharacterMaterials(team)
  const pistol = weapon === 'Pistol' || weapon === 'HandCannon'
  const rest = pistol ? REST.pistol : REST.rifle

  useFrame((_, delta) => {
    const g = gun.current
    if (!g) return
    const me = world.me
    const a = world.arsenal
    // Scoped in: the scope overlay replaces the gun.
    const visible = !!me?.alive && !a?.zoomed
    g.visible = visible
    if (!visible) return

    world.recoil = Math.max(0, world.recoil - delta * 6)
    const speed = world.sim?.horizontal_speed() ?? 0
    const grounded = world.sim?.on_ground() ?? true
    bob.current += delta * speed * 1.6
    const bobAmt = grounded ? Math.min(speed / 6, 1) : 0

    reload.current = THREE.MathUtils.damp(reload.current, (a?.reload_left ?? 0) > 0 ? 1 : 0, 10, delta)
    const r = reload.current
    // Draw: comes up from below the screen.
    const draw = Math.min(1, (a?.draw_left ?? 0) / C.draw_time)

    g.position.set(
      rest.x + Math.sin(bob.current) * 0.012 * bobAmt,
      rest.y - Math.abs(Math.cos(bob.current)) * 0.01 * bobAmt - r * 0.25 - draw * 0.3,
      rest.z + world.recoil * 0.06,
    )
    g.rotation.set(world.recoil * 0.12 - r * 0.6 - draw * 0.8, 0, r * 0.3)

    if (flash.current) flash.current.visible = performance.now() - world.muzzleFlashAt < 40
  })

  return (
    <group ref={gun}>
      <GunModel weapon={weapon} m={m} />
      <mesh ref={flash} position={GUNS[weapon].muzzle} visible={false} material={flashMat}>
        <icosahedronGeometry args={[0.05, 0]} />
      </mesh>
    </group>
  )
}

export function ViewModel() {
  return (
    <Hud renderPriority={1}>
      <PerspectiveCamera makeDefault fov={68} near={0.01} far={10} position={[0, 0, 0]} />
      {/* Same sun and sky as the world, so the gun sits in the scene. */}
      <hemisphereLight args={[LIGHTING.sky, LIGHTING.ground, 1.3]} />
      <directionalLight position={[-1, 2, 1]} color={LIGHTING.sun} intensity={2.6} />
      <Weapon />
    </Hud>
  )
}
