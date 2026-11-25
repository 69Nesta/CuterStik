// Player settings, persisted to localStorage as one JSON blob. Read by the
// input code and scene every frame through `useSettings.getState()`, and by
// React through the hook.
import { create } from 'zustand'

export const CROSSHAIR_COLORS = ['#ffffff', '#3ddc84', '#ffe14d', '#38e8ff', '#ff5ad1', '#ff5a64'] as const

export type Quality = 'performance' | 'balanced' | 'quality'

export type Settings = {
  // Mouse
  sensitivity: number
  invertY: boolean
  // Video
  quality: Quality
  shadows: boolean
  speedFov: boolean
  // Crosshair
  crosshair: {
    color: string
    length: number
    thickness: number
    gap: number
    outline: boolean
    dot: boolean
    /** Spread the lines apart while moving/firing. */
    dynamic: boolean
  }
  // Minimap
  minimap: {
    show: boolean
    rotate: boolean
    /** Keep the player in the middle; otherwise the whole map is shown. */
    centered: boolean
    /** Meters from the center to the edge of the minimap. */
    range: number
    size: number
  }
  // HUD
  /** Performance overlay: nothing, an FPS number, or the full graph. */
  perf: PerfMode
}

export type PerfMode = 'off' | 'fps' | 'graph'

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 2.2,
  invertY: false,
  quality: 'balanced',
  shadows: true,
  speedFov: true,
  crosshair: { color: '#ffffff', length: 7, thickness: 2, gap: 4, outline: true, dot: false, dynamic: false },
  minimap: { show: true, rotate: true, centered: true, range: 26, size: 220 },
  perf: 'fps',
}

const KEY = 'settings'

function load(): Settings {
  const out = structuredClone(DEFAULT_SETTINGS)
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    // Dropped settings from older builds.
    delete (saved as Record<string, unknown>).fov
    delete (saved as Record<string, unknown>).netgraph
    // Shallow-merge each section so new fields get their defaults.
    Object.assign(out, saved, {
      crosshair: { ...out.crosshair, ...saved.crosshair },
      minimap: { ...out.minimap, ...saved.minimap },
    })
  } catch {
    /* corrupt blob: fall back to defaults */
  }
  // Older builds stored sensitivity on its own.
  const legacy = localStorage.getItem('sensitivity')
  if (legacy !== null) {
    out.sensitivity = Number(legacy) || out.sensitivity
    localStorage.removeItem('sensitivity')
  }
  return out
}

export const useSettings = create<Settings>(load)

useSettings.subscribe((s) => localStorage.setItem(KEY, JSON.stringify(s)))

/** Update a top-level setting. */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  useSettings.setState({ [key]: value } as Partial<Settings>)
}

/** Update one field of a nested section. */
export function setSection<S extends 'crosshair' | 'minimap', K extends keyof Settings[S]>(
  section: S,
  key: K,
  value: Settings[S][K],
) {
  useSettings.setState((s) => ({ [section]: { ...s[section], [key]: value } }) as Partial<Settings>)
}

export function resetSettings() {
  useSettings.setState(structuredClone(DEFAULT_SETTINGS))
}

export const QUALITY_DPR: Record<Quality, [number, number]> = {
  performance: [0.75, 1],
  balanced: [1, 1.5],
  quality: [1, 2],
}
