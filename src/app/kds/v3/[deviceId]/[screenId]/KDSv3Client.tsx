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
 *
 * The admin preview at /admin/kds-v3/screens/[id]/preview wraps the same
 * KDSv3GridCanvas in a parent-width-scaling shell (KDSv3PreviewCanvas) +
 * a manual refresh button, instead of polling.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { KDSv3GridCanvas } from '@/components/kds/v3/KDSv3GridCanvas'
import type { ResolvedScreen } from '@/lib/kds/v3-render'

const POLL_INTERVAL_MS = 30_000

export function KDSv3Client({ resolved }: { resolved: ResolvedScreen }) {
  const router = useRouter()

  useEffect(() => {
    const t = setInterval(() => router.refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [router])

  return <KDSv3GridCanvas resolved={resolved} />
}
