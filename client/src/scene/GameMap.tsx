// Renders the map straight from the shared Rust map definition, so what you
// see is exactly what the server collides against. Decals are flat and
// purely visual, so they never disagree with collision.
import { useMemo } from 'react'
import * as THREE from 'three'
import { MAP } from '../wasm'
import { getSurfaceMaterials, surfaceGeometry } from './materials'
import { stencilTexture } from './textures'
import { SITES } from '../game/mapInfo'

function SiteMarks() {
  const marks = useMemo(
    () =>
      SITES.map(({ label, x, z, r, yaw }) => ({
        key: label,
        position: [x, 0.012, z] as const,
        size: r * 2,
        yaw,
        material: new THREE.MeshStandardMaterial({
          map: stencilTexture(label, '#f1ead9'),
          transparent: true,
          depthWrite: false,
          roughness: 0.85,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      })),
    [],
  )
  return (
    <group>
      {marks.map((m) => (
        <mesh
          key={m.key}
          position={m.position}
          rotation={[-Math.PI / 2, 0, m.yaw]}
          material={m.material}
          receiveShadow
        >
          <planeGeometry args={[m.size, m.size]} />
        </mesh>
      ))}
    </group>
  )
}

export function GameMap() {
  const materials = getSurfaceMaterials()

  const boxes = useMemo(
    () =>
      MAP.map((box) => {
        const { min, max } = box.bounds
        // Geometry is built in world space around the box center.
        return {
          geometry: surfaceGeometry(min, max, box.surface),
          position: [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2] as const,
          surface: box.surface,
        }
      }),
    [],
  )

  return (
    <group>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          geometry={b.geometry}
          material={materials[b.surface]}
          position={b.position}
          castShadow={b.surface !== 'Floor'}
          receiveShadow
        />
      ))}
      <SiteMarks />
    </group>
  )
}
