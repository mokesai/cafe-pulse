'use client'

import { useEffect, useState } from 'react'

interface ExceptionCountBadgeProps {
  /** If provided, uses this count directly (no fetch) */
  count?: number
  /** If true, fetches the open count from the API */
  autoFetch?: boolean
  className?: string
}

export function ExceptionCountBadge({ count: countProp, autoFetch = false, className }: ExceptionCountBadgeProps) {
  const [count, setCount] = useState<number>(countProp ?? 0)

  useEffect(() => {
    if (countProp !== undefined) {
      setCount(countProp)
      return
    }
    if (!autoFetch) return

    const fetchCount = async () => {
      try {
        const res = await fetch('/api/admin/invoice-exceptions?status=open&limit=1')
        if (res.ok) {
          const data = await res.json()
          setCount(data.open_count ?? 0)
        }
      } catch {
        // silently fail
      }
    }

    fetchCount()
    const interval = setInterval(fetchCount, 30_000)
    return () => clearInterval(interval)
  }, [countProp, autoFetch])

  if (count <= 0) return null

  const label = count > 99 ? '99+' : String(count)

  return (
    <span
      className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-semibold bg-amber-500 text-white ${className ?? ''}`}
      aria-label={`${count} open exceptions`}
    >
      {label}
    </span>
  )
}
