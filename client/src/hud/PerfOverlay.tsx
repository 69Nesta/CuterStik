// Performance overlay. "FPS" shows a single number; "Graph" adds a
// frame-time history, the worst frame of the last second, ping, and the
// prediction stats. Everything updates outside React (refs + rAF).
import { useEffect, useRef } from 'react'
import { useSettings } from '../game/settings'
import { world } from '../game/world'

const HISTORY = 120
const GRAPH_W = 180
const GRAPH_H = 48
/** Frame time at the top of the graph, ms. */
const GRAPH_MAX_MS = 50

const frameColor = (ms: number) => (ms <= 17.5 ? '#3ddc84' : ms <= 34 ? '#ffd23f' : '#ff4f4f')
const fpsClass = (fps: number) => (fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad')
const pingClass = (ms: number) => (ms <= 60 ? 'good' : ms <= 120 ? 'ok' : 'bad')

export function PerfOverlay() {
  const mode = useSettings((s) => s.perf)
  const minimap = useSettings((s) => s.minimap)
  const fpsRef = useRef<HTMLSpanElement>(null)
  const statsRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (mode === 'off') return
    const frames = new Float32Array(HISTORY)
    let head = 0
    let last = performance.now()
    let windowStart = last
    let windowFrames = 0
    let worst = 0
    let raf = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = now - last
      last = now
      frames[head] = dt
      head = (head + 1) % HISTORY
      windowFrames++
      worst = Math.max(worst, dt)

      // Text refreshes twice a second so the numbers are readable.
      if (now - windowStart >= 500) {
        const fps = (windowFrames * 1000) / (now - windowStart)
        if (fpsRef.current) {
          fpsRef.current.textContent = String(Math.round(fps))
          fpsRef.current.className = `fps ${fpsClass(fps)}`
        }
        if (statsRef.current) {
          const ping = world.ping
          const sim = world.sim
          statsRef.current.innerHTML =
            `<span>${(1000 / fps).toFixed(1)} ms avg · ${worst.toFixed(1)} ms max</span>` +
            `<span>ping <b class="${ping === null ? '' : pingClass(ping)}">${ping === null ? '--' : Math.round(ping)}</b> ms` +
            ` · tick ${world.latest?.tick ?? 0}</span>` +
            `<span>unacked ${sim?.pending_count() ?? 0} · ${(sim?.horizontal_speed() ?? 0).toFixed(1)} m/s</span>`
        }
        windowStart = now
        windowFrames = 0
        worst = 0
      }

      const canvas = graphRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== GRAPH_W * dpr) {
        canvas.width = GRAPH_W * dpr
        canvas.height = GRAPH_H * dpr
      }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, GRAPH_W, GRAPH_H)
      const y = (ms: number) => GRAPH_H - (Math.min(ms, GRAPH_MAX_MS) / GRAPH_MAX_MS) * GRAPH_H
      const barW = GRAPH_W / HISTORY
      for (let i = 0; i < HISTORY; i++) {
        const ms = frames[(head + i) % HISTORY]
        if (!ms) continue
        ctx.fillStyle = frameColor(ms)
        const top = y(ms)
        ctx.fillRect(i * barW, top, Math.max(1, barW - 0.3), GRAPH_H - top)
      }
      // 60 and 30 FPS guides.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      for (const ms of [1000 / 60, 1000 / 30]) {
        ctx.beginPath()
        ctx.moveTo(0, Math.round(y(ms)) + 0.5)
        ctx.lineTo(GRAPH_W, Math.round(y(ms)) + 0.5)
        ctx.stroke()
      }
      ctx.setLineDash([])
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mode])

  if (mode === 'off') return null
  // Sits under the minimap when it's shown.
  const top = minimap.show ? 14 + minimap.size + 14 : 14
  return (
    <div className={`perf ${mode}`} style={{ top }} aria-hidden>
      <div className="perf-head">
        <span ref={fpsRef} className="fps">--</span>
        <small>FPS</small>
      </div>
      {mode === 'graph' && (
        <>
          <canvas ref={graphRef} style={{ width: GRAPH_W, height: GRAPH_H }} />
          <div ref={statsRef} className="perf-stats" />
        </>
      )}
    </div>
  )
}
