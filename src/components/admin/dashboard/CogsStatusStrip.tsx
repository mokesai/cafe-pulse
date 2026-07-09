'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react'
import type { CogsStatus, CogsSignal } from '@/lib/cogs/dashboard-status'

interface CogsStatusData extends CogsStatus {
  openBlockExceptions: number
  itemsNeedingPriceReview: number
  sparkline: number[]
  weekRange: { start: string; end: string }
}

const SIGNAL_STYLES: Record<CogsSignal, { label: string; chip: string; bar: string }> = {
  good: { label: 'On target', chip: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500' },
  warning: { label: 'Watch', chip: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' },
  alert: { label: 'Over target', chip: 'bg-red-100 text-red-800', bar: 'bg-red-500' },
  no_sales: { label: 'No sales yet', chip: 'bg-gray-100 text-gray-700', bar: 'bg-gray-400' },
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 120
  const h = 32
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / span) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="text-indigo-400" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function CogsStatusStrip() {
  const [data, setData] = useState<CogsStatusData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch('/api/admin/dashboard/cogs-status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((j) => {
        if (active) setData(j.data as CogsStatusData)
      })
      .catch(() => {})
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <div className="h-28 rounded-xl bg-white shadow-sm border border-gray-200 animate-pulse" />
  }
  if (!data) return null

  const style = SIGNAL_STYLES[data.signal]
  const cogsPctLabel = data.cogsPct == null ? '—' : `${data.cogsPct}%`
  const trendUp = data.trendPp != null && data.trendPp > 0

  return (
    <div className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
      <div className={`h-1 w-full ${style.bar}`} />
      <div className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Weekly COGS</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">${data.weeklyCogs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-xs text-gray-500 mt-1">{data.weekRange.start} → {data.weekRange.end}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">COGS % of sales</p>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="text-3xl font-bold text-gray-900">{cogsPctLabel}</p>
              <span className="text-xs text-gray-500">target {data.targetPct}%</span>
            </div>
            {data.trendPp != null ? (
              <p className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${trendUp ? 'text-red-600' : 'text-emerald-600'}`}>
                {trendUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {trendUp ? '+' : ''}{data.trendPp} pp vs last week
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">no prior-week comparison</p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <Sparkline values={data.sparkline} />
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${style.chip}`}>
              {data.signal === 'good' ? <CheckCircle className="w-4 h-4" /> : data.signal === 'no_sales' ? null : <AlertTriangle className="w-4 h-4" />}
              {style.label}
            </span>
          </div>
        </div>

        {data.openBlockExceptions > 0 && (
          <Link
            href="/admin/invoice-exceptions"
            className="mt-4 flex items-center gap-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 hover:bg-red-100 transition-colors"
          >
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span className="text-sm font-medium text-red-900">
              {data.openBlockExceptions} invoice exception{data.openBlockExceptions === 1 ? '' : 's'} need{data.openBlockExceptions === 1 ? 's' : ''} resolution
            </span>
            <span className="ml-auto text-sm font-semibold text-red-700">Review →</span>
          </Link>
        )}

        {data.itemsNeedingPriceReview > 0 && (
          <Link
            href="/admin/inventory"
            className="mt-3 flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 hover:bg-amber-100 transition-colors"
          >
            <TrendingUp className="w-5 h-5 text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-900">
              {data.itemsNeedingPriceReview} item{data.itemsNeedingPriceReview === 1 ? '' : 's'} had a supplier cost jump — review menu price{data.itemsNeedingPriceReview === 1 ? '' : 's'}
            </span>
            <span className="ml-auto text-sm font-semibold text-amber-700">Review →</span>
          </Link>
        )}
      </div>
    </div>
  )
}
