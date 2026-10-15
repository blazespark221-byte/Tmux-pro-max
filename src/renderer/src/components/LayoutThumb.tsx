import { useMemo } from 'react'
import { computeGeometry } from '@shared/layout'
import type { LayoutPreset } from '@shared/layout'

/** Miniature drawing of a layout preset. */
export function LayoutThumb({ preset, size = 40 }: { preset: LayoutPreset; size?: number }) {
  const rects = useMemo(() => {
    const ids = Array.from({ length: preset.count }, (_, i) => `c${i}`)
    const geo = computeGeometry(preset.build(ids))
    return ids.map((id) => geo.panes[id])
  }, [preset])
  const w = size
  const h = Math.round(size * 0.66)
  const gap = 1.5
  return (
    <svg className="layout-thumb" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x * w + gap / 2}
          y={r.y * h + gap / 2}
          width={Math.max(1, r.w * w - gap)}
          height={Math.max(1, r.h * h - gap)}
          rx={1.5}
        />
      ))}
    </svg>
  )
}
