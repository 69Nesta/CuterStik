// Bullet tracers and impact flashes from a fixed pool of meshes.
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { world } from '../game/world'

const POOL = 48
const TRACER_MS = 90
const IMPACT_MS = 160

const up = new THREE.Vector3(0, 1, 0)
const a = new THREE.Vector3()
const b = new THREE.Vector3()
const dir = new THREE.Vector3()

export function Effects() {
  const tracers = useRef<(THREE.Mesh | null)[]>([])
  const impacts = useRef<(THREE.Mesh | null)[]>([])
  const indices = useMemo(() => Array.from({ length: POOL }, (_, i) => i), [])

  useFrame(() => {
    const now = performance.now()
    world.tracers = world.tracers.filter((t) => now - t.born < IMPACT_MS)

    for (let i = 0; i < POOL; i++) {
      const line = tracers.current[i]
      const dot = impacts.current[i]
      const t = world.tracers[i]
      if (!line || !dot) continue
      if (!t) {
        line.visible = dot.visible = false
        continue
      }
      const age = now - t.born
      a.set(t.from.x, t.from.y, t.from.z)
      b.set(t.to.x, t.to.y, t.to.z)
      dir.subVectors(b, a)
      const len = dir.length()

      line.visible = age < TRACER_MS && len > 0.01
      if (line.visible) {
        line.position.copy(a).addScaledVector(dir, 0.5)
        line.quaternion.setFromUnitVectors(up, dir.normalize())
        line.scale.set(1, len, 1)
        ;(line.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - age / TRACER_MS)
      }

      dot.visible = true
      dot.position.copy(b)
      dot.scale.setScalar(1 + age / 60)
      ;(dot.material as THREE.MeshBasicMaterial).opacity = 1 - age / IMPACT_MS
    }
  })

  return (
    <group>
      {indices.map((i) => (
        <group key={i}>
          <mesh ref={(m) => void (tracers.current[i] = m)} visible={false} frustumCulled={false}>
            <cylinderGeometry args={[0.012, 0.012, 1, 4, 1, true]} />
            <meshBasicMaterial color="#ffe9a8" transparent depthWrite={false} />
          </mesh>
          <mesh ref={(m) => void (impacts.current[i] = m)} visible={false}>
            <sphereGeometry args={[0.05, 6, 4]} />
            <meshBasicMaterial color="#fff3c4" transparent depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
