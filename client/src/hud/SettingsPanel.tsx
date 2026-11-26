// Settings modal, shared by the lobby and the in-game pause menu. Every
// change applies immediately and is saved to localStorage.
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  CROSSHAIR_COLORS,
  resetSettings,
  setSection,
  setSetting,
  useSettings,
  type PerfMode,
  type Quality,
} from '../game/settings'
import { CrosshairShape } from './Crosshair'

type Tab = 'general' | 'video' | 'crosshair' | 'minimap'
const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'video', label: 'Video' },
  { id: 'crosshair', label: 'Crosshair' },
  { id: 'minimap', label: 'Minimap' },
]

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        {label}
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

function Slider(props: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  const { value, min, max, step, onChange, format = (v) => String(v) } = props
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format(value)}</output>
    </>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`toggle ${value ? 'on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span>{value ? 'On' : 'Off'}</span>
    </button>
  )
}

function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'active' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function General() {
  const s = useSettings()
  return (
    <>
      <Row label="Sensitivity" hint="0.022° per mouse count, like most shooters">
        <Slider value={s.sensitivity} min={0.2} max={8} step={0.05} onChange={(v) => setSetting('sensitivity', v)} format={(v) => v.toFixed(2)} />
      </Row>
      <Row label="Invert vertical look">
        <Toggle value={s.invertY} onChange={(v) => setSetting('invertY', v)} />
      </Row>
      <Row label="Volume" hint="Gunshots, footsteps, bomb and UI sounds">
        <Slider value={s.volume} min={0} max={1} step={0.05} onChange={(v) => setSetting('volume', v)} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Performance overlay" hint="Graph adds frame times, ping and net stats">
        <Segmented<PerfMode>
          value={s.perf}
          onChange={(v) => setSetting('perf', v)}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'fps', label: 'FPS' },
            { value: 'graph', label: 'Graph' },
          ]}
        />
      </Row>
    </>
  )
}

function Video() {
  const s = useSettings()
  return (
    <>
      <Row label="Speed FOV kick" hint="Widen the view while sprinting or sliding">
        <Toggle value={s.speedFov} onChange={(v) => setSetting('speedFov', v)} />
      </Row>
      <Row label="Render quality" hint="Resolution scale on high-DPI screens">
        <Segmented<Quality>
          value={s.quality}
          onChange={(v) => setSetting('quality', v)}
          options={[
            { value: 'performance', label: 'Performance' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'quality', label: 'Quality' },
          ]}
        />
      </Row>
      <Row label="Shadows">
        <Toggle value={s.shadows} onChange={(v) => setSetting('shadows', v)} />
      </Row>
    </>
  )
}

function Crosshair() {
  const c = useSettings((s) => s.crosshair)
  const set = <K extends keyof typeof c>(k: K, v: (typeof c)[K]) => setSection('crosshair', k, v)
  return (
    <>
      <div className="crosshair-preview" aria-hidden>
        <CrosshairShape style={c} />
      </div>
      <Row label="Color">
        <div className="swatches">
          {CROSSHAIR_COLORS.map((col) => (
            <button
              key={col}
              type="button"
              className={`swatch ${c.color === col ? 'active' : ''}`}
              style={{ background: col }}
              aria-label={col}
              onClick={() => set('color', col)}
            />
          ))}
        </div>
      </Row>
      <Row label="Line length">
        <Slider value={c.length} min={0} max={20} step={1} onChange={(v) => set('length', v)} />
      </Row>
      <Row label="Thickness">
        <Slider value={c.thickness} min={1} max={6} step={1} onChange={(v) => set('thickness', v)} />
      </Row>
      <Row label="Center gap">
        <Slider value={c.gap} min={0} max={16} step={1} onChange={(v) => set('gap', v)} />
      </Row>
      <Row label="Center dot">
        <Toggle value={c.dot} onChange={(v) => set('dot', v)} />
      </Row>
      <Row label="Outline">
        <Toggle value={c.outline} onChange={(v) => set('outline', v)} />
      </Row>
      <Row label="Movement & firing error" hint="Lines spread while moving or spraying">
        <Toggle value={c.dynamic} onChange={(v) => set('dynamic', v)} />
      </Row>
    </>
  )
}

function Minimap() {
  const m = useSettings((s) => s.minimap)
  const set = <K extends keyof typeof m>(k: K, v: (typeof m)[K]) => setSection('minimap', k, v)
  return (
    <>
      <Row label="Show minimap">
        <Toggle value={m.show} onChange={(v) => set('show', v)} />
      </Row>
      <Row label="Rotate with view" hint="Your facing always points up">
        <Toggle value={m.rotate} onChange={(v) => set('rotate', v)} />
      </Row>
      <Row label="Keep player centered" hint="Off shows the whole map">
        <Toggle value={m.centered} onChange={(v) => set('centered', v)} />
      </Row>
      <Row label="Zoom" hint="Meters from center to edge">
        <Slider value={m.range} min={12} max={40} step={1} onChange={(v) => set('range', v)} format={(v) => `${v} m`} />
      </Row>
      <Row label="Size">
        <Slider value={m.size} min={140} max={320} step={10} onChange={(v) => set('size', v)} format={(v) => `${v}px`} />
      </Row>
    </>
  )
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portal to <body> so lobby/HUD layout rules can't reposition the modal.
  return createPortal(
    <div
      className="settings-backdrop"
      // Clicks must not reach the pause overlay (which grabs pointer lock).
      onClick={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings panel" role="dialog" aria-label="Settings">
        <header>
          <h2>Settings</h2>
          <nav role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>
        <div className="settings-body">
          {tab === 'general' && <General />}
          {tab === 'video' && <Video />}
          {tab === 'crosshair' && <Crosshair />}
          {tab === 'minimap' && <Minimap />}
        </div>
        <footer>
          <button type="button" className="btn btn-light" onClick={resetSettings}>
            Reset to defaults
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
