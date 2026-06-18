'use client'

/**
 * MOK-158 / KDS v3 phase 6 — public renderer client wrapper.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T10)
 *
 *  - Wraps KDSv3GridCanvas (the 1920×1080 inner) — the parent route page wraps
 *    THIS wrapper in KDSDisplayWrapper for viewport scaling.
 *  - Adds 30s polling refresh via router.refresh() — picks up operator edits
 *    without requiring a full reload. Polling stops on unmount.
 *  - Adds a 30-minute safety reload via window.location.reload() — clears
 *    accumulated client-side state (RSC payload merging in Next.js dev, plus
 *    general memory/state drift in long-running kiosk tabs). Surfaced
 *    2026-06-03 during Phase 8 operator validation: a Pi tab running ~1hr
 *    of router.refresh() polls eventually threw "frame.join is not a
 *    function" — Next.js dev error-overlay's tell that the RSC merge state
 *    got corrupted. Hard reload every 30 min gives the renderer a clean
 *    slate without affecting normal 30s content polling.
 *
 * The admin preview at /admin/kds-v3/screens/[id]/preview wraps the same
 * KDSv3GridCanvas in a parent-width-scaling shell (KDSv3PreviewCanvas) +
 * a manual refresh button, instead of polling.
 */
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { KDSv3GridCanvas } from '@/components/kds/v3/KDSv3GridCanvas'
import type { ResolvedScreen } from '@/lib/kds/v3-render'

const POLL_INTERVAL_MS = 30_000
// 60 polls × 30s = 30 min between hard reloads. Long enough that the
// brief blank-during-reload doesn't disrupt operator flow; short enough
// that accumulated state never gets to the failure point we saw at ~1hr.
const HARD_RELOAD_EVERY_N_POLLS = 60

export function KDSv3Client({ resolved }: { resolved: ResolvedScreen }) {
  const router = useRouter()
  const tickRef = useRef(0)

  useEffect(() => {
    const t = setInterval(() => {
      tickRef.current += 1
      if (tickRef.current >= HARD_RELOAD_EVERY_N_POLLS) {
        // Full reload — recovers from any accumulated React tree / RSC
        // state corruption. The tick counter resets on the next mount.
        window.location.reload()
        return
      }
      router.refresh()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [router])

  return <KDSv3GridCanvas resolved={resolved} />
}
