// Renders the map straight from the shared Rust map definition, so what you
// see is exactly what the server collides against.
import { useMemo } from 'react'
import * as THREE from 'three'
import { MAP } from '../wasm'
import type { MapBox } from '../net/protocol'
import { Outlines } from '@react-three/drei'
import { INK, SURFACE_STYLE, getSurfaceMaterials } from './materials'

/** Box geometry whose UVs are in world units / tile size. */
function makeGeometry(box: MapBox) {
  const { min, max } = box.bounds
  const sx = max.x - min.x
  const sy = max.y - min.y
  const sz = max.z - min.z
  const geo = new THREE.BoxGeometry(sx, sy, sz)
  const tile = SURFACE_STYLE[box.surface].tile
  const uv = geo.attributes.uv as THREE.BufferAttribute
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const faceSize: [number, number][] = [
    [sz, sy], [sz, sy],
    [sx, sz], [sx, sz],
    [sx, sy], [sx, sy],
  ]
  for (let face = 0; face < 6; face++) {
    const [u, v] = faceSize[face]
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i
      uv.setXY(idx, (uv.getX(idx) * u) / tile, (uv.getY(idx) * v) / tile)
    }
  }
  return geo
}

export function GameMap() {
  const materials = getSurfaceMaterials()

  const boxes = useMemo(
    () =>
      MAP.map((box) => {
        const { min, max } = box.bounds
        return {
          geometry: makeGeometry(box),
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
        >
          {b.surface !== 'Floor' && <Outlines thickness={0.04} color={INK} />}
        </mesh>
      ))}
    </group>
  )
}
