'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'

const CANVAS_W = 1920
const CANVAS_H = 1080

/**
 * Auto-scales the 1920x1080 KDS layout to fit any screen resolution.
 * Maintains aspect ratio and centers the content.
 */
export default function KDSDisplayWrapper({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1)

  const updateScale = useCallback(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const scaleX = vw / CANVAS_W
    const scaleY = vh / CANVAS_H
    setScale(Math.min(scaleX, scaleY))
  }, [])

  useEffect(() => {
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [updateScale])

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: CANVAS_W * scale,
        height: CANVAS_H * scale,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transformOrigin: '0 0',
          transform: `scale(${scale})`,
        }}>
          {children}
        </div>
      </div>
    </div>
  )
}
