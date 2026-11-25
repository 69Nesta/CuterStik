// Prototype "dev" materials, in the spirit of Unreal's WorldGridMaterial and
// Unity prototype textures: flat colors with a metric grid, toon-shaded so
// the whole game reads as a cartoon blockout. All textures are generated on
// a canvas at startup; nothing is downloaded.
import * as THREE from 'three'
import type { Surface, Team } from '../net/protocol'

export const TEAM_COLOR: Record<Team, string> = { T: '#ff4f6d', Ct: '#2fa4ff' }
export const NEUTRAL_COLOR = '#b8bec8'
/** Free-for-all: every opponent wears this. */
export const FFA_COLOR = '#ffd23f'
export const INK = '#1d2130'

type GridStyle = {
  base: string
  line: string
  /** Meters covered by one texture repeat. */
  tile: number
  /** Grid cells per tile; every cell gets a line, the tile edge a thick one. */
  cells: number
  /** Size stamp in the tile corner. Only for flat planes: box UVs mirror it. */
  label?: string
}

export const SURFACE_STYLE: Record<Surface, GridStyle> = {
  Floor: { base: '#9ba2ac', line: '#6b727d', tile: 4, cells: 4 },
  Wall: { base: '#e4e7eb', line: '#a5abb5', tile: 4, cells: 4 },
  Crate: { base: '#ff9b2f', line: '#c2620c', tile: 1, cells: 2 },
  Platform: { base: '#8f7cff', line: '#5a47cf', tile: 2, cells: 4 },
}

function finish(canvas: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

export function gridTexture({ base, line, cells, label }: GridStyle) {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)

  const cell = size / cells
  ctx.strokeStyle = line
  // Half-cell lines: faint.
  ctx.globalAlpha = 0.35
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i < cells; i++) {
    const p = i * cell + cell / 2
    ctx.moveTo(p, 0); ctx.lineTo(p, size)
    ctx.moveTo(0, p); ctx.lineTo(size, p)
  }
  ctx.stroke()
  // Cell lines.
  ctx.globalAlpha = 0.8
  ctx.lineWidth = 3
  ctx.beginPath()
  for (let i = 1; i < cells; i++) {
    const p = i * cell
    ctx.moveTo(p, 0); ctx.lineTo(p, size)
    ctx.moveTo(0, p); ctx.lineTo(size, p)
  }
  ctx.stroke()
  // Tile edge: thick, drawn half on each side so repeats line up.
  ctx.globalAlpha = 1
  ctx.lineWidth = 8
  ctx.strokeRect(0, 0, size, size)

  if (label) {
    ctx.fillStyle = line
    ctx.font = '700 34px Rubik, system-ui, sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillText(label, 16, 14)
  }
  return finish(canvas)
}

/** Two-tone checker, like a UV test texture, for characters. */
export function checkerTexture(color: string, squares = 8) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = new THREE.Color(color)
  ctx.fillStyle = `#${c.getHexString()}`
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = `#${c.clone().multiplyScalar(0.82).getHexString()}`
  const s = size / squares
  for (let y = 0; y < squares; y++)
    for (let x = (y % 2); x < squares; x += 2) ctx.fillRect(x * s, y * s, s, s)
  return finish(canvas)
}

let toonRamp: THREE.DataTexture | null = null
/** Three hard light bands: the cel-shaded look. */
export function toonGradient() {
  if (toonRamp) return toonRamp
  const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255])
  toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter
  toonRamp.generateMipmaps = false
  toonRamp.needsUpdate = true
  return toonRamp
}

export function toon(params: THREE.MeshToonMaterialParameters) {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params })
}

let surfaceMaterials: Record<Surface, THREE.MeshToonMaterial> | null = null
export function getSurfaceMaterials() {
  if (!surfaceMaterials) {
    const out = {} as Record<Surface, THREE.MeshToonMaterial>
    for (const s of Object.keys(SURFACE_STYLE) as Surface[]) {
      out[s] = toon({ map: gridTexture(SURFACE_STYLE[s]) })
    }
    surfaceMaterials = out
  }
  return surfaceMaterials
}

export type CharacterMaterials = {
  body: THREE.MeshToonMaterial
  joint: THREE.MeshToonMaterial
  visor: THREE.MeshToonMaterial
  gun: THREE.MeshToonMaterial
  gunAccent: THREE.MeshToonMaterial
}

const characterCache = new Map<string, CharacterMaterials>()
export type Look = Team | 'ffa' | null

/** Materials for a team, free-for-all opponents, or `null` (neutral). */
export function getCharacterMaterials(look: Look) {
  const key = look ?? 'none'
  let m = characterCache.get(key)
  if (!m) {
    const color = look === 'ffa' ? FFA_COLOR : look ? TEAM_COLOR[look] : NEUTRAL_COLOR
    m = {
      body: toon({ map: checkerTexture(color) }),
      joint: toon({ color: '#3a3f4d' }),
      visor: toon({ color: INK }),
      gun: toon({ color: '#454b59' }),
      gunAccent: toon({ color: '#ff9b2f' }),
    }
    characterCache.set(key, m)
  }
  return m
}
