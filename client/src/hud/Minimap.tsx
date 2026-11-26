// Top-down minimap drawn on a 2D canvas. The map layer is baked once from
// the shared map boxes; players are drawn on top every frame.
//
// Teammates always show. Enemies show only while spotted: inside the view
// cone of you or a living teammate with clear line of sight. A spotted
// enemy leaves a fading "last seen" marker for a moment after.
import { useEffect, useRef } from 'react'
import { BOMB_SITES, C, MAP, RAMPS, raycastMap } from '../wasm'
import { SITES, SPAWN_ZONES } from '../game/mapInfo'
import { useSettings } from '../game/settings'
import { useHud } from '../game/store'
import { world } from '../game/world'
import type { PlayerId, Team } from '../net/protocol'
import { TEAM_COLOR, FFA_COLOR } from '../scene/materials'
import { sample } from '../scene/RemotePlayers'

const BAKE_PX_PER_M = 10
/** Spotting rules. */
const SPOT_RANGE = 60
const SPOT_HALF_FOV = (55 * Math.PI) / 180
const SPOT_INTERVAL_MS = 100
const LAST_SEEN_MS = 1500
/** View cone drawn for the local player, in meters. */
const CONE_LEN = 9

type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number }

/** Map layer: floor, low cover, tall walls, platforms. */
function bakeMap(): { canvas: HTMLCanvasElement; bounds: Bounds } {
  const floor = MAP.find((b) => b.surface === 'Floor')!.bounds
  const bounds = { minX: floor.min.x, minZ: floor.min.z, maxX: floor.max.x, maxZ: floor.max.z }
  const canvas = document.createElement('canvas')
  canvas.width = (bounds.maxX - bounds.minX) * BAKE_PX_PER_M
  canvas.height = (bounds.maxZ - bounds.minZ) * BAKE_PX_PER_M
  const ctx = canvas.getContext('2d')!
  ctx.scale(BAKE_PX_PER_M, BAKE_PX_PER_M)
  ctx.translate(-bounds.minX, -bounds.minZ)

  ctx.fillStyle = 'rgba(60, 54, 46, 0.9)'
  ctx.fillRect(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)

  // Spawn areas, faintly tinted.
  for (const s of SPAWN_ZONES) {
    ctx.fillStyle = TEAM_COLOR[s.team as Team] + '2a'
    ctx.fillRect(s.x - 10, s.z - 3.5, 20, 7)
  }

  // Low cover first so tall geometry draws over it; taller reads brighter.
  const boxes = MAP.filter((b) => b.surface !== 'Floor').sort(
    (a, b) => a.bounds.max.y - b.bounds.max.y,
  )
  for (const { bounds: bb, surface } of boxes) {
    const h = bb.max.y
    const x = bb.min.x
    const z = bb.min.z
    const w = bb.max.x - bb.min.x
    const d = bb.max.z - bb.min.z
    ctx.fillStyle =
      surface === 'Platform' || surface === 'Stairs'
        ? '#3c8f8a'
        : surface === 'Crate'
          ? h > 1.6 ? '#c98a55' : '#8e6844'
          : h > 1.6 ? '#efe3cc' : '#a89a83'
    ctx.fillRect(x, z, w, d)
    ctx.strokeStyle = 'rgba(20, 16, 12, 0.55)'
    ctx.lineWidth = 0.15
    ctx.strokeRect(x, z, w, d)
  }
  // Ramps: shaded from low (dark) to high (light) end.
  for (const { bounds: bb, rise } of RAMPS) {
    const w = bb.max.x - bb.min.x
    const d = bb.max.z - bb.min.z
    const [x0, z0, x1, z1] =
      rise === 'PosX' ? [bb.min.x, 0, bb.max.x, 0]
        : rise === 'NegX' ? [bb.max.x, 0, bb.min.x, 0]
          : rise === 'PosZ' ? [0, bb.min.z, 0, bb.max.z]
            : [0, bb.max.z, 0, bb.min.z]
    const grad = ctx.createLinearGradient(x0, z0, x1, z1)
    grad.addColorStop(0, '#2c5f5c')
    grad.addColorStop(1, '#5fb3ad')
    ctx.fillStyle = grad
    ctx.fillRect(bb.min.x, bb.min.z, w, d)
    ctx.strokeStyle = 'rgba(20, 16, 12, 0.55)'
    ctx.lineWidth = 0.15
    ctx.strokeRect(bb.min.x, bb.min.z, w, d)
  }

  // Bomb plant zones.
  ctx.setLineDash([0.6, 0.5])
  ctx.lineWidth = 0.18
  ctx.strokeStyle = 'rgba(255, 155, 47, 0.75)'
  for (const site of BOMB_SITES) {
    ctx.beginPath()
    ctx.arc(site.x, site.z, site.radius, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.setLineDash([])
  return { canvas, bounds }
}

type Seen = { x: number; z: number; at: number; live: boolean }

/** Recomputes which enemies are spotted, updating `seen`. */
function updateSpotting(seen: Map<PlayerId, Seen>, now: number) {
  const snap = world.latest
  if (!snap) return
  const myTeam = useHud.getState().myTeam
  const ffa = useHud.getState().room?.mode === 'Deathmatch'
  const spotters = snap.players.filter(
    (p) => p.alive && (p.id === world.myId || (!ffa && p.team === myTeam)),
  )
  for (const s of seen.values()) s.live = false

  for (const enemy of snap.players) {
    if (enemy.id === world.myId || !enemy.alive || (!ffa && enemy.team === myTeam)) continue
    const target = sample(enemy.id) ?? { ...enemy.mv.pos }
    const tx = target.x
    const ty = target.y + C.head_start * 0.85
    const tz = target.z
    const spotted = spotters.some((s) => {
      const ex = s.mv.pos.x
      const ey = s.mv.pos.y + (s.mv.crouched ? C.crouch_eye_height : C.eye_height)
      const ez = s.mv.pos.z
      const dx = tx - ex
      const dy = ty - ey
      const dz = tz - ez
      const dist = Math.hypot(dx, dy, dz)
      if (dist > SPOT_RANGE || dist < 0.01) return false
      // Horizontal angle between the spotter's facing and the enemy.
      const yaw = s.id === world.myId ? world.yaw : s.yaw
      const fx = -Math.sin(yaw)
      const fz = -Math.cos(yaw)
      const flat = Math.hypot(dx, dz) || 1
      if ((fx * dx + fz * dz) / flat < Math.cos(SPOT_HALF_FOV)) return false
      const hit = raycastMap(ex, ey, ez, dx / dist, dy / dist, dz / dist, dist)
      return hit >= dist - 0.05
    })
    if (spotted) seen.set(enemy.id, { x: tx, z: tz, at: now, live: true })
  }
  for (const [id, s] of seen) if (!s.live && now - s.at > LAST_SEEN_MS) seen.delete(id)
}

export function Minimap() {
  const show = useSettings((s) => s.minimap.show)
  const size = useSettings((s) => s.minimap.size)
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!show) return
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const { canvas: base, bounds } = bakeMap()
    const seen = new Map<PlayerId, Seen>()
    const pos = new Float32Array(3)
    let lastSpot = 0
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const now = performance.now()
      const { minimap } = useSettings.getState()
      const hud = useHud.getState()
      const ffa = hud.room?.mode === 'Deathmatch'
      const dpr = window.devicePixelRatio || 1
      const S = minimap.size
      if (canvas.width !== S * dpr) {
        canvas.width = canvas.height = S * dpr
      }
      if (now - lastSpot > SPOT_INTERVAL_MS) {
        lastSpot = now
        updateSpotting(seen, now)
      }

      // Where the local player is (falls back to the map center).
      const me = world.me
      const alive = !!(me?.alive && me.spawn_id > 0 && world.sim)
      let px = (bounds.minX + bounds.maxX) / 2
      let pz = (bounds.minZ + bounds.maxZ) / 2
      if (alive) {
        world.sim!.render_pos(1, pos)
        px = pos[0]
        pz = pos[2]
      }

      const centered = minimap.centered && alive
      const cx = centered ? px : (bounds.minX + bounds.maxX) / 2
      const cz = centered ? pz : (bounds.minZ + bounds.maxZ) / 2
      const halfSpan = centered
        ? minimap.range
        : Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + 1
      const k = S / 2 / halfSpan // px per meter
      // Rotating so the player's facing points up: canvas rotate(yaw).
      const rot = minimap.rotate && alive ? world.yaw : 0
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      const toScreen = (x: number, z: number): [number, number] => {
        const dx = x - cx
        const dz = z - cz
        return [S / 2 + (dx * cos - dz * sin) * k, S / 2 + (dx * sin + dz * cos) * k]
      }
      /** Screen-space angle of a world yaw (0 = up). */
      const screenAngle = (yaw: number) => rot - yaw

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, S, S)
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(0, 0, S, S, 14)
      ctx.clip()
      ctx.fillStyle = 'rgba(18, 22, 30, 0.72)'
      ctx.fillRect(0, 0, S, S)

      // Map layer.
      ctx.save()
      ctx.translate(S / 2, S / 2)
      ctx.rotate(rot)
      ctx.scale(k, k)
      ctx.translate(-cx, -cz)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(base, bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
      ctx.restore()

      // Site letters stay upright.
      ctx.font = `900 ${Math.max(12, 2.2 * k)}px Rubik, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const site of SITES) {
        const [x, y] = toScreen(site.x, site.z)
        ctx.fillStyle = 'rgba(241, 234, 217, 0.85)'
        ctx.fillText(site.label, x, y)
      }

      // Local player's view cone.
      if (alive) {
        const [x, y] = toScreen(px, pz)
        const a = screenAngle(world.yaw) - Math.PI / 2
        const half = (40 * Math.PI) / 180
        const grad = ctx.createRadialGradient(x, y, 0, x, y, CONE_LEN * k)
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.32)')
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.arc(x, y, CONE_LEN * k, a - half, a + half)
        ctx.closePath()
        ctx.fill()
      }

      // Teammates.
      const snap = world.latest
      if (snap && !ffa) {
        for (const p of snap.players) {
          if (p.id === world.myId || p.team !== hud.myTeam || !p.alive) continue
          const s = sample(p.id) ?? { x: p.mv.pos.x, z: p.mv.pos.z, yaw: p.yaw }
          const [x, y] = toScreen(s.x, s.z)
          drawPlayer(ctx, x, y, screenAngle(s.yaw), TEAM_COLOR[p.team], 1)
        }
      }

      // The bomb: attackers always know where it is; once planted, everyone.
      const bomb = snap?.bomb
      if (bomb && typeof bomb === 'object') {
        let at: { x: number; z: number } | null = null
        if ('Planted' in bomb) at = bomb.Planted.pos
        else if ('Dropped' in bomb && hud.myTeam === 'T') at = bomb.Dropped.pos
        else if ('Carried' in bomb && hud.myTeam === 'T' && bomb.Carried.by !== world.myId) {
          at = sample(bomb.Carried.by)
        }
        if (at) {
          const [x, y] = toScreen(at.x, at.z)
          const blink = 'Planted' in bomb ? Math.sin(now / 120) > 0 : true
          drawBomb(ctx, x, y, blink)
        }
      }

      // Spotted enemies, and fading last-seen markers.
      if (snap) {
        for (const [id, s] of seen) {
          const p = snap.players.find((q) => q.id === id)
          if (!p) continue
          const color = ffa ? FFA_COLOR : TEAM_COLOR[p.team]
          if (s.live) {
            const live = sample(id)
            const [x, y] = toScreen(live?.x ?? s.x, live?.z ?? s.z)
            drawPlayer(ctx, x, y, screenAngle(live?.yaw ?? p.yaw), color, 1)
          } else {
            const [x, y] = toScreen(s.x, s.z)
            const fade = 1 - (now - s.at) / LAST_SEEN_MS
            drawLastSeen(ctx, x, y, color, Math.max(0, fade))
          }
        }
      }

      // You, on top of everything.
      if (alive) {
        const [x, y] = toScreen(px, pz)
        drawSelf(ctx, x, y, screenAngle(world.yaw))
      }

      // North marker when the map rotates.
      if (rot !== 0) {
        const nx = S / 2 + Math.sin(rot) * (S / 2 - 12)
        const ny = S / 2 - Math.cos(rot) * (S / 2 - 12)
        ctx.font = '800 11px Rubik, system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.fillText('N', nx, ny)
      }
      ctx.restore()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [show])

  if (!show) return null
  return (
    <canvas
      ref={ref}
      className="minimap"
      style={{ width: size, height: size }}
      aria-label="Minimap"
    />
  )
}

/** A dot with a small facing wedge. `angle` is screen-space, 0 = up. */
function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, alpha: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, -9)
  ctx.lineTo(4, -4.5)
  ctx.lineTo(-4, -4.5)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, 0, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(15, 18, 24, 0.9)'
  ctx.stroke()
  ctx.restore()
}

function drawSelf(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = '#ffe14d'
  ctx.strokeStyle = 'rgba(15, 18, 24, 0.95)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, -8)
  ctx.lineTo(6, 6)
  ctx.lineTo(0, 3)
  ctx.lineTo(-6, 6)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawLastSeen(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, alpha: number) {
  ctx.save()
  ctx.globalAlpha = alpha * 0.85
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x - 4, y - 4)
  ctx.lineTo(x + 4, y + 4)
  ctx.moveTo(x + 4, y - 4)
  ctx.lineTo(x - 4, y + 4)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 7, 0, Math.PI * 2)
  ctx.globalAlpha = alpha * 0.4
  ctx.stroke()
  ctx.restore()
}

function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean) {
  ctx.save()
  ctx.translate(x, y + 10)
  ctx.fillStyle = lit ? '#ff3b30' : '#7a1f1a'
  ctx.strokeStyle = 'rgba(15, 18, 24, 0.95)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(-5, -4, 10, 8, 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
