'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Monitor, Maximize2, Minimize2 } from 'lucide-react'

const CANVAS_W = 1920
const CANVAS_H = 1080

interface KDSPreviewClientProps {
  screen: 'drinks' | 'food'
  children: React.ReactNode
}

export default function KDSPreviewClient({ screen, children }: KDSPreviewClientProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [scale, setScale] = useState(1)

  const updateScale = useCallback(() => {
    const vw = window.innerWidth - (isFullscreen ? 0 : 48)
    const vh = window.innerHeight - (isFullscreen ? 0 : 96)
    setScale(Math.min(vw / CANVAS_W, vh / CANVAS_H, 1))
  }, [isFullscreen])

  useEffect(() => {
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [updateScale])

  const otherScreen = screen === 'drinks' ? 'food' : 'drinks'

  return (
    <div className={`flex flex-col bg-black ${isFullscreen ? 'fixed inset-0 z-50' : 'h-screen'}`}>
      {!isFullscreen && (
        <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
          <Link href={`/admin/kds-config/editor/${screen}`}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />Back to Editor
          </Link>
          <div className="flex rounded-lg overflow-hidden border border-gray-600 ml-2">
            {(['drinks', 'food'] as const).map(s => (
              <Link key={s} href={`/admin/kds-config/preview/${s}`}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${screen === s ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-2">
            <Monitor className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">Previewing at {CANVAS_W}×{CANVAS_H}</span>
            <span className="text-xs text-gray-600">({Math.round(scale * 100)}% scale)</span>
          </div>
          <div className="flex-1" />
          <Link href={`/admin/kds-config/preview/${otherScreen}`} className="text-xs text-gray-400 hover:text-white">
            Switch to {otherScreen.charAt(0).toUpperCase() + otherScreen.slice(1)} →
          </Link>
          <button onClick={() => setIsFullscreen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg">
            <Maximize2 className="w-3.5 h-3.5" />Full Screen
          </button>
        </div>
      )}

      {isFullscreen && (
        <button onClick={() => setIsFullscreen(false)}
          className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs rounded-lg">
          <Minimize2 className="w-3.5 h-3.5" />Exit Full Screen
        </button>
      )}

      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div style={{ width: CANVAS_W * scale, height: CANVAS_H * scale, overflow: 'hidden', position: 'relative' }}>
          <div style={{ width: CANVAS_W, height: CANVAS_H, transformOrigin: '0 0', transform: `scale(${scale})` }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
