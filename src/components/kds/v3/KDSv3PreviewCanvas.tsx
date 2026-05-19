'use client'

/**
 * KDS v3 phase 6 — admin preview canvas.
 *
 * Wraps the 1920×1080 KDSv3GridCanvas in a parent-width-scaling shell so an
 * admin can iterate on a screen's layout without needing a paired device or
 * full-viewport real estate. Pairs with /admin/kds-v3/screens/[id]/preview.
 *
 * Scales by parent width (not viewport, the way the Pi-facing wrapper does)
 * so the 16:9 preview fits comfortably inside the admin layout's content area.
 * Uses ResizeObserver — same pattern the editor uses for its layout preview.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { KDSv3GridCanvas, CANVAS_W, CANVAS_H } from './KDSv3GridCanvas'
import type { ResolvedScreen } from '@/lib/kds/v3-render'

const SCALE_MIN_PCT = 50
const SCALE_MAX_PCT = 100

interface KDSv3PreviewCanvasProps {
  resolved: ResolvedScreen
  /**
   * Optional refresh handler. Default behavior calls router.refresh() — fine
   * for the standalone preview page (server component re-fetches on
   * revalidation). The edit-page tab provides a client-side re-fetch via
   * this prop so the preview can update without a page transition.
   */
  onRefresh?: () => void | Promise<void>
}

export function KDSv3PreviewCanvas({ resolved, onRefresh }: KDSv3PreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // User-chosen scale percentage. `null` means "fit to container width"
  // (the original auto-scale behavior). Once the operator drags the
  // slider, we lock to that explicit percentage until they click Fit.
  const [userScalePct, setUserScalePct] = useState<number | null>(null)
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth(w)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const fitScale = width > 0 ? width / CANVAS_W : 0
  const scale = userScalePct != null ? userScalePct / 100 : fitScale
  const scaledHeight = CANVAS_H * scale
  const scaledWidth = CANVAS_W * scale
  const displayPct = Math.round(scale * 100)
  // Slider value: reflect either the user pick or the current fit-to-width
  // percentage so the slider visually sits at the right spot before the
  // operator interacts.
  const sliderValue = userScalePct ?? Math.round(fitScale * 100)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      if (onRefresh) {
        await onRefresh()
      } else {
        router.refresh()
        // Visual feedback only — the server component re-fetches on revalidate.
      }
    } finally {
      // Short delay so the operator gets visual confirmation even when the
      // re-fetch resolves in <50ms; avoids a "did anything happen?" feel.
      setTimeout(() => setRefreshing(false), 400)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-600">
            Live preview at 16:9 · {displayPct}%
            {userScalePct == null && (
              <span className="ml-1 text-xs text-gray-400">(fit to width)</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="kds-v3-preview-scale" className="text-xs text-gray-500">
              Scale
            </label>
            <input
              id="kds-v3-preview-scale"
              type="range"
              min={SCALE_MIN_PCT}
              max={SCALE_MAX_PCT}
              step={1}
              value={sliderValue}
              onChange={(e) => setUserScalePct(Number(e.target.value))}
              className="accent-blue-600"
            />
            <span className="w-10 text-xs tabular-nums text-gray-600">{sliderValue}%</span>
            <button
              type="button"
              onClick={() => setUserScalePct(null)}
              disabled={userScalePct == null}
              title="Auto-fit preview to container width"
              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Fit
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || width === 0}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Outer ref captures available width for the fit-scale calculation. */}
      <div ref={containerRef}>
        <div
          // Viewport with scroll. Capped at 75vh so cranking the scale to
          // 100% doesn't push the rest of the admin chrome off-screen.
          className="overflow-auto rounded-md border border-gray-300 bg-black"
          style={{ maxHeight: '75vh' }}
        >
          {/* Scroll-extent: sized to the scaled canvas dimensions so the
              browser computes overflow correctly. `transform: scale` doesn't
              change the box model, so we need an explicitly-sized parent
              for the scrollable area to match the visual canvas. */}
          {width > 0 && (
            <div style={{ width: scaledWidth, height: scaledHeight }}>
              <div
                style={{
                  transformOrigin: '0 0',
                  transform: `scale(${scale})`,
                  width: CANVAS_W,
                  height: CANVAS_H,
                }}
              >
                <KDSv3GridCanvas resolved={resolved} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
