'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cogsChipLabel, type CogsSignal } from '@/lib/cogs/dashboard-status'

interface ChipData {
  cogsPct: number | null
  signal: CogsSignal
  openBlockExceptions: number
}

const TONE: Record<CogsSignal, { dot: string; text: string }> = {
  good: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  warning: { dot: 'bg-amber-500', text: 'text-amber-700' },
  alert: { dot: 'bg-red-500', text: 'text-red-700' },
  no_sales: { dot: 'bg-gray-400', text: 'text-gray-600' },
}

/**
 * B2 / MOK-174 — persistent COGS health chip in the admin top bar (every page). Reuses the B1
 * dashboard cogs-status endpoint; links into the dashboard. Renders nothing until loaded.
 */
export function CogsStatusChip() {
  const [data, setData] = useState<ChipData | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/admin/dashboard/cogs-status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((j) => {
        if (active) setData(j.data as ChipData)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!data) return null
  const tone = TONE[data.signal]

  return (
    <Link
      href="/admin/dashboard"
      title="Weekly COGS status — open the dashboard"
      className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 transition-colors"
    >
      <span className={`w-2 h-2 rounded-full ${tone.dot}`} aria-hidden />
      <span className={tone.text}>{cogsChipLabel(data.cogsPct)}</span>
      {data.openBlockExceptions > 0 && (
        <span
          className="ml-0.5 inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold"
          title={`${data.openBlockExceptions} open invoice exception${data.openBlockExceptions === 1 ? '' : 's'}`}
        >
          {data.openBlockExceptions}
        </span>
      )}
    </Link>
  )
}
