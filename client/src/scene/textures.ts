// Procedural hand-painted textures. The art direction is stylized-tactical:
// clean readable shapes, soft painted gradients instead of photo detail,
// light edge wear painted straight into the albedo, warm stone and plaster
// against teal metal accents.
//
// Everything is generated on a canvas at startup (nothing is downloaded),
// seeded so it looks the same every launch, and tileable: every noise
// period is an integer number of repeats. Each texture also produces a
// height field that becomes a soft normal map.
import * as THREE from 'three'

type RGB = [number, number, number]

/** sRGB hex to 0..1 components, without color management. */
export function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Noise = (u: number, v: number) => number

/** Tileable value noise with `px` by `py` cells over the unit square. */
function valueNoise(seed: number, px: number, py: number): Noise {
  const r = mulberry32(seed)
  const g = new Float32Array(px * py)
  for (let i = 0; i < g.length; i++) g[i] = r()
  return (u, v) => {
    const x = (((u % 1) + 1) % 1) * px
    const y = (((v % 1) + 1) % 1) * py
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    let fx = x - xi
    let fy = y - yi
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    const x1 = (xi + 1) % px
    const y1 = (yi + 1) % py
    const a = g[yi * px + xi]
    const b = g[yi * px + x1]
    const c = g[y1 * px + xi]
    const d = g[y1 * px + x1]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
}

/** Fractal noise in 0..1. Each octave doubles both periods, so it still tiles. */
function fbm(seed: number, px: number, py: number, octaves = 4): Noise {
  const layers = Array.from({ length: octaves }, (_, i) =>
    valueNoise(seed + i * 7919, px << i, py << i),
  )
  let norm = 0
  for (let i = 0; i < octaves; i++) norm += 0.5 ** i
  return (u, v) => {
    let s = 0
    for (let i = 0; i < octaves; i++) s += layers[i](u, v) * 0.5 ** i
    return s / norm
  }
}

/** A canvas-sized albedo + height buffer that we paint pixel by pixel. */
class Painting {
  readonly albedo: Float32Array
  readonly height: Float32Array
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.albedo = new Float32Array(w * h * 3)
    this.height = new Float32Array(w * h)
  }

  /**
   * Calls `fn` for every pixel with (u, v) in 0..1, v = 0 at the BOTTOM of
   * the texture (the way it lands on geometry with flipY), and stores what
   * it returns.
   */
  paint(fn: (u: number, v: number) => { c: RGB; h: number }) {
    const { w, h } = this
    for (let y = 0; y < h; y++) {
      const v = 1 - (y + 0.5) / h
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w
        const { c, h: ht } = fn(u, v)
        const i = y * w + x
        this.albedo[i * 3] = c[0]
        this.albedo[i * 3 + 1] = c[1]
        this.albedo[i * 3 + 2] = c[2]
        this.height[i] = ht
      }
    }
    return this
  }

  private canvas(fill: (data: Uint8ClampedArray) => void) {
    const canvas = document.createElement('canvas')
    canvas.width = this.w
    canvas.height = this.h
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(this.w, this.h)
    fill(img.data)
    ctx.putImageData(img, 0, 0)
    return canvas
  }

  toMap() {
    const a = this.albedo
    const canvas = this.canvas((d) => {
      for (let i = 0, n = this.w * this.h; i < n; i++) {
        d[i * 4] = clamp01(a[i * 3]) * 255
        d[i * 4 + 1] = clamp01(a[i * 3 + 1]) * 255
        d[i * 4 + 2] = clamp01(a[i * 3 + 2]) * 255
        d[i * 4 + 3] = 255
      }
    })
    return finish(canvas, THREE.SRGBColorSpace)
  }

  /** Normal map from the height field; `strength` scales the slopes. */
  toNormalMap(strength: number) {
    const { w, h, height } = this
    const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)]
    const canvas = this.canvas((d) => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          // Canvas rows run top-down, texture v runs bottom-up.
          const du = (at(x + 1, y) - at(x - 1, y)) * strength
          const dv = (at(x, y - 1) - at(x, y + 1)) * strength
          const len = Math.hypot(du, dv, 1)
          const i = (y * w + x) * 4
          d[i] = (-du / len * 0.5 + 0.5) * 255
          d[i + 1] = (-dv / len * 0.5 + 0.5) * 255
          d[i + 2] = (1 / len * 0.5 + 0.5) * 255
          d[i + 3] = 255
        }
    })
    return finish(canvas, THREE.NoColorSpace)
  }
}

function finish(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace) {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = colorSpace
  tex.anisotropy = 8
  return tex
}

export type PaintedTexture = { map: THREE.Texture; normalMap: THREE.Texture }

function bake(p: Painting, normalStrength: number): PaintedTexture {
  return { map: p.toMap(), normalMap: p.toNormalMap(normalStrength) }
}

// ---------------------------------------------------------------------------
// Stone tiles (floors, wall caps, baseboards)

type Rect = { x0: number; y0: number; x1: number; y1: number; tone: number; hue: number }

/** Cuts a `cols` by `rows` grid of blocks into slabs of varying sizes. */
function slabLayout(seed: number, cols: number, rows: number): Rect[] {
  const r = mulberry32(seed)
  const out: Rect[] = []
  const push = (x0: number, y0: number, x1: number, y1: number) =>
    out.push({ x0, y0, x1, y1, tone: r() * 2 - 1, hue: r() * 2 - 1 })
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx / cols
      const y0 = by / rows
      const w = 1 / cols
      const h = 1 / rows
      const pick = r()
      if (pick < 0.35) push(x0, y0, x0 + w, y0 + h)
      else if (pick < 0.6) {
        push(x0, y0, x0 + w / 2, y0 + h / 2)
        push(x0 + w / 2, y0, x0 + w, y0 + h / 2)
        push(x0, y0 + h / 2, x0 + w / 2, y0 + h)
        push(x0 + w / 2, y0 + h / 2, x0 + w, y0 + h)
      } else if (pick < 0.8) {
        push(x0, y0, x0 + w, y0 + h / 2)
        push(x0, y0 + h / 2, x0 + w, y0 + h)
      } else {
        push(x0, y0, x0 + w / 2, y0 + h)
        push(x0 + w / 2, y0, x0 + w, y0 + h)
      }
    }
  return out
}

type StonePalette = { stone: string; warm: string; grout: string; dirt: string }

/**
 * Bevelled flagstones. `meters` is the world size of one repeat, used to
 * keep grout and bevel widths physical.
 */
function stoneTiles(opts: {
  size: number
  meters: number
  blocks: number
  palette: StonePalette
  seed: number
}) {
  const { size, meters, blocks, palette, seed } = opts
  const stone = rgb(palette.stone)
  const warm = rgb(palette.warm)
  const grout = rgb(palette.grout)
  const dirt = rgb(palette.dirt)
  const slabs = slabLayout(seed, blocks, blocks)
  const mottle = fbm(seed + 1, 4, 4, 5)
  const fine = fbm(seed + 2, 32, 32, 3)
  const chips = fbm(seed + 3, 8 * meters, 8 * meters, 2)
  const grime = fbm(seed + 4, 2, 2, 4)
  const groutW = 0.022 / meters
  const bevel = 0.07 / meters

  return new Painting(size, size).paint((u, v) => {
    let s = slabs[0]
    for (const r of slabs)
      if (u >= r.x0 && u < r.x1 && v >= r.y0 && v < r.y1) {
        s = r
        break
      }
    const dl = u - s.x0
    const dr = s.x1 - u
    const db = v - s.y0
    const dt = s.y1 - v
    const d = Math.min(dl, dr, db, dt)
    // Grout lines wobble a little so they read as hand-laid.
    const wob = (fine(u, v) - 0.5) * groutW * 0.8
    const g = d - wob
    if (g < groutW) {
      const c = mix(grout, dirt, grime(u, v) * 0.5)
      return { c: shade(c, 0.9 + fine(u, v) * 0.2), h: 0 }
    }

    // Slab body: per-slab tone, low-frequency mottling, fine grain.
    let c = mix(stone, warm, clamp01(0.5 + s.hue * 0.5))
    c = shade(c, 1 + s.tone * 0.1 + (mottle(u, v) - 0.5) * 0.2 + (fine(u, v) - 0.5) * 0.06)
    const bev = smooth(groutW, groutW + bevel, g)
    let ht = 0.35 + bev * 0.65 + (fine(u, v) - 0.5) * 0.08

    // Painted bevel lighting: the edges facing the sun (top/left) catch a
    // highlight, the others fall into soft shade.
    if (bev < 1) {
      const edge = 1 - bev
      const lit = d === dl || d === dt
      c = shade(c, lit ? 1 + edge * 0.22 : 1 - edge * 0.2)
    }
    // Chipped corners and edges.
    const chip = chips(u, v)
    if (g < groutW + bevel * 1.4 && chip > 0.7) {
      c = shade(mix(c, grout, 0.2), 0.92)
      ht -= 0.25
    }
    // Grime collects toward the grout.
    c = mix(c, dirt, (1 - smooth(groutW, groutW + bevel * 3, g)) * 0.18 + grime(u, v) * 0.08)
    return { c, h: ht }
  })
}

// ---------------------------------------------------------------------------
// Public textures. Sizes are chosen around ~128 px per meter.

/** Warm flagstone floor: one repeat covers 8 m. */
export function floorTexture(): PaintedTexture {
  return bake(
    stoneTiles({
      size: 1024,
      meters: 8,
      blocks: 4,
      seed: 11,
      palette: { stone: '#a09482', warm: '#ae9a7c', grout: '#5f5548', dirt: '#6f6252' },
    }),
    3,
  )
}

/** Pale stone caps for the tops of walls: one repeat covers 2 m. */
export function capTexture(): PaintedTexture {
  return bake(
    stoneTiles({
      size: 256,
      meters: 2,
      blocks: 2,
      seed: 23,
      palette: { stone: '#dccbb0', warm: '#e4cfa9', grout: '#9c8a70', dirt: '#a8957a' },
    }),
    2,
  )
}

/**
 * Plaster wall: 8 m by 8 m per repeat, v = 0 at ground level.
 * Stone baseboard at the bottom, soft ambient occlusion above it, painted
 * plaster blotches, and chipped patches showing the brick underneath.
 */
export function wallTexture(): PaintedTexture {
  const W = 1024
  const H = 1024
  const M_W = 8
  const M_H = 8
  const plaster = rgb('#efe0c6')
  const plasterWarm = rgb('#e6c9a0')
  const plasterLight = rgb('#f7eedf')
  const baseStone = rgb('#b9a689')
  const baseLedge = rgb('#d6c4a4')
  const mortar = rgb('#d8c4a4')
  const brick = rgb('#b4654a')
  const brickAlt = rgb('#9e5340')
  const big = fbm(31, 4, 4, 5)
  const streak = fbm(32, 6, 96, 3)
  const fine = fbm(33, 96, 96, 2)
  const chipEdge = fbm(34, 32, 32, 3)
  const brickTone = valueNoise(35, 128, 400)

  // Chipped plaster patches, in meters, all above the baseboard.
  const r = mulberry32(36)
  const chips = Array.from({ length: 2 }, (_, i) => ({
    x: (i + 0.2 + r() * 0.6) * (M_W / 2),
    y: 1.0 + r() * 4.5,
    rx: 0.2 + r() * 0.5,
    ry: 0.15 + r() * 0.3,
  }))

  const BASE = 0.5 // baseboard height, m
  const LEDGE = 0.07 // ledge on top of it
  const block = 1 // baseboard block width, m

  return bake(
    new Painting(W, H).paint((u, v) => {
      const x = u * M_W
      const y = v * M_H

      if (y < BASE + LEDGE) {
        // Baseboard: big stone blocks with a lighter ledge on top.
        if (y >= BASE) {
          const t = (y - BASE) / LEDGE
          return { c: shade(baseLedge, 0.92 + t * 0.12 + (fine(u, v) - 0.5) * 0.06), h: 1 }
        }
        const bx = x % block
        const d = Math.min(bx, block - bx, y, BASE - y)
        if (d < 0.02) return { c: shade(baseStone, 0.6), h: 0.2 }
        const id = Math.floor(x / block)
        const tone = 1 + (((id * 9301 + 49297) % 233) / 233 - 0.5) * 0.12
        let c = shade(baseStone, tone + (big(u, v) - 0.5) * 0.15 + (fine(u, v) - 0.5) * 0.08)
        const bev = smooth(0.02, 0.07, d)
        if (bev < 1) c = shade(c, d === BASE - y || d === bx ? 1 + (1 - bev) * 0.18 : 1 - (1 - bev) * 0.18)
        return { c, h: 0.4 + bev * 0.5 }
      }

      // Plaster.
      const b = big(u, v)
      let c = mix(plaster, plasterWarm, smooth(0.45, 0.8, b) * 0.6)
      c = mix(c, plasterLight, smooth(0.5, 0.2, b) * 0.5)
      c = shade(c, 1 + (streak(u, v) - 0.5) * 0.05 + (fine(u, v) - 0.5) * 0.04)
      // Soft contact shadow above the ledge, plus grime splashed up from the floor.
      const ao = 1 - smooth(BASE + LEDGE + 0.8, BASE + LEDGE, y)
      c = shade(c, 1 - ao * 0.14)
      c = mix(c, rgb('#b8a07c'), ao * 0.12 * b)
      let ht = 0.6 + (fine(u, v) - 0.5) * 0.12 + (streak(u, v) - 0.5) * 0.06

      // Chipped plaster revealing brick. Distances wrap across the tile.
      for (const p of chips) {
        let dx = Math.abs(x - p.x)
        dx = Math.min(dx, M_W - dx)
        const dy = (y - p.y) / p.ry
        const e = Math.hypot(dx / p.rx, dy) + (chipEdge(u, v) - 0.5) * 0.9
        if (e < 1) {
          // Running-bond bricks, 25 x 8 cm.
          const row = Math.floor(y / 0.08)
          const bxw = x + (row % 2) * 0.125
          const inX = bxw % 0.25
          const inY = y % 0.08
          if (inX < 0.012 || inY < 0.01) return { c: shade(mortar, 0.9), h: 0.1 }
          const t = brickTone(bxw / M_W, y / M_H)
          let bc = mix(brick, brickAlt, t)
          bc = shade(bc, 0.92 + (fine(u, v) - 0.5) * 0.14)
          // The plaster edge casts a thin painted shadow onto the brick.
          if (e > 0.82) bc = shade(bc, 0.7)
          return { c: bc, h: 0.25 }
        }
        if (e < 1.12) {
          // Bright broken lip of plaster around the chip.
          c = shade(c, 1.08)
          ht += 0.1
        }
      }
      return { c, h: ht }
    }),
    2.2,
  )
}

/**
 * Wooden crate face, one 1 m module per repeat: a dark frame, horizontal
 * planks with grain, a diagonal brace and steel corner brackets.
 */
export function crateTexture(): PaintedTexture {
  const S = 256
  const frameWood = rgb('#7f4f2d')
  const plank = rgb('#b67b45')
  const plankAlt = rgb('#a3693a')
  const steel = rgb('#4b5059')
  const steelEdge = rgb('#8d949e')
  const grain = fbm(41, 2, 48, 3)
  const knots = fbm(42, 8, 8, 3)
  const wear = fbm(43, 16, 16, 3)
  const F = 0.12 // frame width
  const PLANKS = 4
  const BR = 0.05 // brace half-width
  const BRACKET = 0.2

  return bake(
    new Painting(S, S).paint((u, v) => {
      const d = Math.min(u, 1 - u, v, 1 - v)
      const g = grain(u, v)

      // Steel L brackets on the four corners, with rivets.
      const cu = Math.min(u, 1 - u)
      const cv = Math.min(v, 1 - v)
      if (cu < BRACKET && cv < BRACKET && (cu < F * 0.75 || cv < F * 0.75)) {
        const rivet = Math.hypot(cu - F * 0.38, cv - F * 0.38) < 0.022 || Math.hypot(cu - BRACKET * 0.78, cv - F * 0.38) < 0.018 || Math.hypot(cu - F * 0.38, cv - BRACKET * 0.78) < 0.018
        if (rivet) return { c: steelEdge, h: 1.3 }
        const edge = Math.min(cu, cv) < 0.012 || (cu > F * 0.75 - 0.01 && cv > F * 0.75 - 0.01)
        let c = edge ? steelEdge : shade(steel, 0.95 + (wear(u, v) - 0.5) * 0.25)
        if (wear(u, v) > 0.7) c = mix(c, steelEdge, 0.5)
        return { c, h: 1.15 }
      }

      // Outer frame.
      if (d < F) {
        let c = shade(frameWood, 0.92 + (g - 0.5) * 0.35)
        // Worn, lighter outer edge.
        if (d < 0.015) c = shade(c, 1.3)
        else if (F - d < 0.012) c = shade(c, 0.65)
        return { c, h: 1 }
      }

      // Diagonal brace, bottom-left to top-right.
      const along = (u - v) / Math.SQRT2
      if (Math.abs(along) < BR) {
        let c = shade(frameWood, 1.02 + (grain(u + v, v - u) - 0.5) * 0.3)
        if (BR - Math.abs(along) < 0.01) c = shade(c, along > 0 ? 0.7 : 1.2)
        return { c, h: 0.9 }
      }

      // Planks.
      const inner = (v - F) / (1 - 2 * F)
      const idx = Math.min(PLANKS - 1, Math.floor(inner * PLANKS))
      const pv = inner * PLANKS - idx
      if (pv < 0.04) return { c: shade(frameWood, 0.45), h: 0.2 }
      let c = mix(plank, plankAlt, (idx * 0.37) % 1)
      c = shade(c, 0.9 + (g - 0.5) * 0.4 + (pv > 0.9 ? -0.08 : 0))
      if (knots(u, v + idx) > 0.78) c = shade(c, 0.78)
      // Soft shadow under the frame and brace.
      const near = Math.min(d - F, Math.abs(along) - BR)
      c = shade(c, 1 - (1 - smooth(0, 0.06, near)) * 0.25)
      return { c, h: 0.55 + (g - 0.5) * 0.08 }
    }),
    3,
  )
}

/** Teal painted metal panel (platform sides), 1 m per repeat. */
export function panelTexture(): PaintedTexture {
  const S = 256
  const paint = rgb('#3c8f8a')
  const paintDark = rgb('#2c6b69')
  const metal = rgb('#c3cbcd')
  const trim = rgb('#e0a33a')
  const blotch = fbm(51, 4, 4, 4)
  const scratch = fbm(52, 32, 4, 3)
  const wear = fbm(53, 16, 16, 4)
  return bake(
    new Painting(S, S).paint((u, v) => {
      const d = Math.min(u, 1 - u, v, 1 - v)
      // Thin warning trim along the top edge of each panel.
      if (v > 0.9 && v < 0.95) return { c: shade(trim, 0.95 + (blotch(u, v) - 0.5) * 0.2), h: 0.8 }
      // Panel seam and inset border.
      if (d < 0.012) return { c: shade(paintDark, 0.55), h: 0 }
      const inset = d < 0.08
      let c = mix(paint, paintDark, inset ? 0.35 : blotch(u, v) * 0.35)
      c = shade(c, 1 + (scratch(u, v) - 0.5) * 0.08)
      if (inset && d > 0.07) c = shade(c, 0.75)
      // Paint worn off near edges, showing bare metal.
      const w = wear(u, v) + (1 - smooth(0.01, 0.06, d)) * 0.2
      if (w > 0.8) c = mix(c, metal, 0.8)
      else if (w > 0.75) c = shade(c, 1.15)
      // Rivets every 25 cm along the border.
      if (inset) {
        const alongEdge = Math.min(u, 1 - u) < Math.min(v, 1 - v) ? v : u
        const t = ((alongEdge * 4) % 1) - 0.5
        if (Math.hypot(t * 0.25, d - 0.04) < 0.016) return { c: shade(metal, 1.05), h: 1.2 }
      }
      return { c, h: inset ? 0.5 : 0.75 }
    }),
    2.5,
  )
}

/** Tread plate for platform tops, 1 m per repeat. */
export function treadTexture(): PaintedTexture {
  const S = 256
  const steel = rgb('#7f9192')
  const steelDark = rgb('#5b6b6d')
  const edge = rgb('#c9d3d4')
  const dirt = fbm(61, 4, 4, 4)
  return bake(
    new Painting(S, S).paint((u, v) => {
      const d = Math.min(u, 1 - u, v, 1 - v)
      if (d < 0.01) return { c: shade(steelDark, 0.6), h: 0 }
      // Diamond tread: alternating raised lozenges on a 12-cell grid.
      const n = 12
      const cx = u * n
      const cy = v * n
      const ix = Math.floor(cx)
      const iy = Math.floor(cy)
      const fx = cx - ix - 0.5
      const fy = cy - iy - 0.5
      const diag = (ix + iy) % 2 === 0
      const a = diag ? fx + fy : fx - fy
      const b = diag ? fx - fy : fx + fy
      const lozenge = Math.abs(a) < 0.5 && Math.abs(b) < 0.1
      let c = mix(steel, steelDark, dirt(u, v) * 0.5)
      if (lozenge) c = mix(c, edge, b > 0 ? 0.45 : 0.15)
      return { c, h: lozenge ? 1 : 0.4 }
    }),
    2,
  )
}

/**
 * A painted floor marking, e.g. a site letter: worn paint with a ring.
 * Returned with alpha so it can lie on top of the floor.
 */
export function stencilTexture(text: string, color: string) {
  const S = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 22
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S / 2 - 24, 0, Math.PI * 2)
  ctx.stroke()
  ctx.font = '900 330px Rubik, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, S / 2, S / 2 + 18)

  // Wear the paint away with noise.
  const img = ctx.getImageData(0, 0, S, S)
  const n = fbm(71 + text.charCodeAt(0), 12, 12, 4)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4 + 3
      if (!img.data[i]) continue
      const k = n(x / S, y / S)
      img.data[i] *= k > 0.62 ? 0.15 : 0.9 - (k - 0.3) * 0.4
    }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}
