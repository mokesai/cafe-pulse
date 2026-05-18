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

  const scale = width > 0 ? width / CANVAS_W : 0
  const scaledHeight = CANVAS_H * scale

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
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Live preview at 16:9 · scaled {Math.round(scale * 100)}% to fit
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || width === 0}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : '⟳ Refresh'}
        </button>
      </div>

      <div
        ref={containerRef}
        className="overflow-hidden rounded-md border border-gray-300 bg-black"
        style={{
          // Reserve space for the scaled canvas height so the layout below
          // doesn't jump on first paint.
          height: scaledHeight > 0 ? scaledHeight : 'auto',
          aspectRatio: scaledHeight > 0 ? undefined : `${CANVAS_W} / ${CANVAS_H}`,
        }}
      >
        {width > 0 && (
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
        )}
      </div>
    </div>
  )
}
