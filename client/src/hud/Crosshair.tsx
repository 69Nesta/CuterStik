// Configurable crosshair. Geometry comes from settings; with "dynamic" on,
// the lines spread with movement speed and recoil (updated per frame
// through a CSS variable, so React doesn't re-render).
import { useEffect, useRef, type CSSProperties } from 'react'
import { useSettings, type Settings } from '../game/settings'
import { world } from '../game/world'

type Props = {
  /** Override settings (live preview in the settings panel). */
  style?: Settings['crosshair']
  /** Show the hitmarker. */
  hit?: boolean
}

export function CrosshairShape({ style: override, hit }: Props) {
  const fromSettings = useSettings((s) => s.crosshair)
  const c = override ?? fromSettings
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!c.dynamic || override) {
      root.current?.style.setProperty('--spread', '0px')
      return
    }
    let raf = 0
    const tick = () => {
      // Follows the real inaccuracy cone of the weapon in hand.
      const cone = world.sim?.inaccuracy() ?? 0
      const spread = Math.min(16, cone * 220 + world.recoil * 6)
      root.current?.style.setProperty('--spread', `${spread.toFixed(1)}px`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [c.dynamic, override])

  const vars = {
    '--len': `${c.length}px`,
    '--thick': `${c.thickness}px`,
    '--gap': `${c.gap}px`,
    '--color': c.color,
    '--outline': c.outline ? '0 0 0 1px rgba(0, 0, 0, 0.85)' : 'none',
  } as CSSProperties

  return (
    <div ref={root} className="crosshair" style={vars}>
      {c.length > 0 && (
        <>
          <i className="h l" />
          <i className="h r" />
          <i className="v t" />
          <i className="v b" />
        </>
      )}
      {c.dot && <i className="dot" />}
      {hit && <div className="hitmarker" />}
    </div>
  )
}
