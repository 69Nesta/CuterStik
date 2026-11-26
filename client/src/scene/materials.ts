// Materials and box geometry for the stylized-tactical look: hand-painted
// textures (see textures.ts) on soft PBR materials, lit by a warm sun with
// cool sky fill. No ink outlines; shapes read through value and color.
import * as THREE from 'three'
import type { Ramp, Surface, Team } from '../net/protocol'
import {
  capTexture,
  crateTexture,
  floorTexture,
  panelTexture,
  treadTexture,
  wallTexture,
  type PaintedTexture,
} from './textures'

export const TEAM_COLOR: Record<Team, string> = { T: '#ff5a64', Ct: '#38b8ff' }
export const NEUTRAL_COLOR = '#c9c2b6'
/** Free-for-all: every opponent wears this. */
export const FFA_COLOR = '#ffc93c'

/** Sun and sky, shared by every scene so the look stays consistent. */
export const LIGHTING = {
  sun: '#ffeed6',
  sky: '#cfe2ff',
  ground: '#a8916f',
  horizon: '#efdcc2',
  zenith: '#4f9be0',
}

/**
 * How a surface's texture lands on a box face.
 * - `world`: UVs are world coordinates / tile, so neighbouring boxes line up
 *   and side faces start at ground level (v = y / tileV).
 * - `fit`: each face shows a whole number of repeats, so framed modules
 *   (crate panels) never get cut in half.
 */
type Mapping = { mode: 'world' | 'fit'; tileU: number; tileV: number }

type SurfaceSpec = { side: Mapping; top: Mapping }

const SPEC: Record<Surface, SurfaceSpec> = {
  Floor: { side: { mode: 'world', tileU: 8, tileV: 8 }, top: { mode: 'world', tileU: 8, tileV: 8 } },
  Wall: { side: { mode: 'world', tileU: 8, tileV: 8 }, top: { mode: 'world', tileU: 2, tileV: 2 } },
  Crate: { side: { mode: 'fit', tileU: 1, tileV: 1 }, top: { mode: 'fit', tileU: 1, tileV: 1 } },
  Platform: { side: { mode: 'fit', tileU: 1, tileV: 1 }, top: { mode: 'fit', tileU: 1, tileV: 1 } },
  Stairs: { side: { mode: 'world', tileU: 1, tileV: 1 }, top: { mode: 'fit', tileU: 1, tileV: 1 } },
}

/** BoxGeometry face order: +x, -x, +y, -y, +z, -z. */
const TOP_FACES = new Set([2, 3])

/** Box geometry for a world-space AABB, with UVs set up for its surface. */
export function surfaceGeometry(min: THREE.Vector3Like, max: THREE.Vector3Like, surface: Surface) {
  const sx = max.x - min.x
  const sy = max.y - min.y
  const sz = max.z - min.z
  const cx = (min.x + max.x) / 2
  const cy = (min.y + max.y) / 2
  const cz = (min.z + max.z) / 2
  const geo = new THREE.BoxGeometry(sx, sy, sz)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const spec = SPEC[surface]
  const faceSize: [number, number][] = [
    [sz, sy], [sz, sy],
    [sx, sz], [sx, sz],
    [sx, sy], [sx, sy],
  ]

  for (let face = 0; face < 6; face++) {
    const m = TOP_FACES.has(face) ? spec.top : spec.side
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i
      if (m.mode === 'fit') {
        const [w, h] = faceSize[face]
        const ru = Math.max(1, Math.round(w / m.tileU))
        const rv = Math.max(1, Math.round(h / m.tileV))
        uv.setXY(idx, uv.getX(idx) * ru, uv.getY(idx) * rv)
        continue
      }
      const x = pos.getX(idx) + cx
      const y = pos.getY(idx) + cy
      const z = pos.getZ(idx) + cz
      // Pick the two world axes in the face's plane, oriented so textures
      // read the right way round from outside the box.
      let u: number
      let v: number
      switch (face) {
        case 0: u = -z; v = y; break
        case 1: u = z; v = y; break
        case 2: u = x; v = -z; break
        case 3: u = x; v = z; break
        case 4: u = x; v = y; break
        default: u = -x; v = y; break
      }
      uv.setXY(idx, u / m.tileU, v / m.tileV)
    }
  }
  return geo
}

/**
 * Wedge for a ramp: a box whose top edge at the low end is pulled down to
 * the floor. Textured like stairs (tread on the slope).
 */
export function rampGeometry(ramp: Ramp) {
  const { min, max } = ramp.bounds
  const geo = surfaceGeometry(min, max, 'Stairs')
  const pos = geo.attributes.position as THREE.BufferAttribute
  const half = { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2, z: (max.z - min.z) / 2 }
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < half.y - 1e-4) continue
    const low =
      ramp.rise === 'PosX' ? pos.getX(i) < 0
        : ramp.rise === 'NegX' ? pos.getX(i) > 0
          : ramp.rise === 'PosZ' ? pos.getZ(i) < 0
            : pos.getZ(i) > 0
    if (low) pos.setY(i, -half.y)
  }
  geo.computeVertexNormals()
  return geo
}

function painted(tex: PaintedTexture, params: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.9,
    metalness: 0,
    ...params,
  })
}

type FaceMaterials = THREE.MeshStandardMaterial[]

/** Six materials per surface, in BoxGeometry face order. */
let surfaceMaterials: Record<Surface, FaceMaterials> | null = null
export function getSurfaceMaterials() {
  if (surfaceMaterials) return surfaceMaterials
  const faces = (side: THREE.MeshStandardMaterial, top: THREE.MeshStandardMaterial) => [
    side, side, top, top, side, side,
  ]
  const floor = painted(floorTexture(), { roughness: 0.92 })
  const wall = painted(wallTexture(), { roughness: 0.95 })
  const cap = painted(capTexture(), { roughness: 0.9 })
  const crate = painted(crateTexture(), { roughness: 0.8 })
  const panel = painted(panelTexture(), { roughness: 0.55 })
  const tread = painted(treadTexture(), { roughness: 0.5 })
  surfaceMaterials = {
    Floor: faces(floor, floor),
    Wall: faces(wall, cap),
    Crate: faces(crate, crate),
    Platform: faces(panel, tread),
    Stairs: faces(panel, tread),
  }
  return surfaceMaterials
}

export type CharacterMaterials = {
  /** Team-colored armor panels. */
  body: THREE.MeshStandardMaterial
  /** Dark undersuit: legs and joints. */
  joint: THREE.MeshStandardMaterial
  /** Glowing visor in the team color. */
  visor: THREE.MeshStandardMaterial
  gun: THREE.MeshStandardMaterial
  gunAccent: THREE.MeshStandardMaterial
}

const characterCache = new Map<string, CharacterMaterials>()
export type Look = Team | 'ffa' | null

export function lookColor(look: Look) {
  return look === 'ffa' ? FFA_COLOR : look ? TEAM_COLOR[look] : NEUTRAL_COLOR
}

/** Materials for a team, free-for-all opponents, or `null` (neutral). */
export function getCharacterMaterials(look: Look) {
  const key = look ?? 'none'
  let m = characterCache.get(key)
  if (!m) {
    const color = lookColor(look)
    m = {
      body: new THREE.MeshStandardMaterial({ color, roughness: 0.45 }),
      joint: new THREE.MeshStandardMaterial({ color: '#2b3039', roughness: 0.7 }),
      visor: new THREE.MeshStandardMaterial({
        color: '#10141c',
        emissive: color,
        emissiveIntensity: 2.2,
        roughness: 0.2,
      }),
      gun: new THREE.MeshStandardMaterial({ color: '#3a3f48', roughness: 0.35, metalness: 0.1 }),
      gunAccent: new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        roughness: 0.4,
      }),
    }
    characterCache.set(key, m)
  }
  return m
}
