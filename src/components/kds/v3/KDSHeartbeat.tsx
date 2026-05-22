'use client'

import { useEffect, useRef } from 'react'

interface KDSHeartbeatProps {
  deviceId: string
  authToken: string
  screen: string
}

/**
 * Client component that sends periodic heartbeats and manages offline detection.
 * Injected into the KDS display page for Pi devices.
 */
export default function KDSHeartbeat({ deviceId, authToken, screen }: KDSHeartbeatProps) {
  const failCountRef = useRef(0)
  const indicatorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    async function sendHeartbeat() {
      try {
        const res = await fetch('/api/kds/heartbeat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            device_id: deviceId,
            screen,
            ip_address: 'local',
          }),
        })

        if (res.ok) {
          failCountRef.current = 0
          // Remove offline indicator if present
          if (indicatorRef.current) {
            indicatorRef.current.remove()
            indicatorRef.current = null
            // Refresh page to pick up any changes made while offline
            window.location.reload()
          }
        } else {
          failCountRef.current++
        }
      } catch {
        failCountRef.current++
      }

      // Show offline indicator after 2 consecutive failures (2 minutes)
      if (failCountRef.current >= 2 && !indicatorRef.current) {
        const el = document.createElement('div')
        el.style.cssText =
          'position:fixed;bottom:12px;right:12px;background:rgba(0,0,0,0.6);' +
          'color:#f87171;padding:6px 14px;border-radius:6px;font-size:14px;' +
          'z-index:9999;display:flex;align-items:center;gap:6px;font-family:sans-serif;'
        el.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f87171;animation:kds-pulse 2s infinite"></span> Offline'

        // Add pulse animation
        if (!document.getElementById('kds-pulse-style')) {
          const style = document.createElement('style')
          style.id = 'kds-pulse-style'
          style.textContent = '@keyframes kds-pulse{0%,100%{opacity:1}50%{opacity:0.3}}'
          document.head.appendChild(style)
        }

        document.body.appendChild(el)
        indicatorRef.current = el
      }
    }

    // Send first heartbeat immediately
    sendHeartbeat()

    // Then every 60 seconds
    const interval = setInterval(sendHeartbeat, 60000)

    return () => {
      clearInterval(interval)
      if (indicatorRef.current) {
        indicatorRef.current.remove()
        indicatorRef.current = null
      }
    }
  }, [deviceId, authToken, screen])

  // This component renders nothing — it's purely side-effect based
  return null
}
