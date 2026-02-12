'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

interface KDSAutoRefreshProps {
  /** Refresh interval in milliseconds (default: 5 minutes) */
  interval?: number
  /** Show refresh indicator */
  showIndicator?: boolean
}

export default function KDSAutoRefresh({
  interval = 5 * 60 * 1000, // 5 minutes default
  showIndicator = true,
}: KDSAutoRefreshProps) {
  const router = useRouter()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [nextRefresh, setNextRefresh] = useState<number>(interval)

  const doRefresh = useCallback(() => {
    setIsRefreshing(true)

    // Trigger Next.js server component refresh
    router.refresh()

    // Reset state after a short delay
    setTimeout(() => {
      setIsRefreshing(false)
      setLastRefresh(new Date())
      setNextRefresh(interval)
    }, 1000)
  }, [router, interval])

  // Auto-refresh timer
  useEffect(() => {
    const timer = setInterval(() => {
      doRefresh()
    }, interval)

    return () => clearInterval(timer)
  }, [interval, doRefresh])

  // Countdown timer
  useEffect(() => {
    const countdown = setInterval(() => {
      setNextRefresh((prev) => Math.max(0, prev - 1000))
    }, 1000)

    return () => clearInterval(countdown)
  }, [lastRefresh])

  // Don't render anything if indicator is disabled
  if (!showIndicator) {
    return null
  }

  const minutes = Math.floor(nextRefresh / 60000)
  const seconds = Math.floor((nextRefresh % 60000) / 1000)

  return (
    <div
      className="kds-refresh-indicator"
      style={{ opacity: isRefreshing ? 1 : 0.5 }}
    >
      <RefreshCw
        className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`}
        style={{ color: isRefreshing ? 'var(--kds-accent)' : 'inherit' }}
      />
      <span>
        {isRefreshing
          ? 'Refreshing...'
          : `Next update: ${minutes}:${seconds.toString().padStart(2, '0')}`}
      </span>
    </div>
  )
}
