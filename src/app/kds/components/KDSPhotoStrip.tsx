'use client'

import { useState, useEffect } from 'react'

interface KDSPhotoStripProps {
  photos: string[]
  /** Rotation interval in milliseconds (default: 8000) */
  rotationInterval?: number
  /** Number of photos to display at once (default: 4) */
  displayCount?: number
}

/**
 * Photo strip at the bottom of each panel showing product photography.
 * Displays appetizing food/drink images with rotation animation.
 * Rotates through photos one at a time using a sliding window.
 */
export default function KDSPhotoStrip({
  photos,
  rotationInterval = 8000,
  displayCount = 4,
}: KDSPhotoStripProps) {
  const [startIndex, setStartIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)

  useEffect(() => {
    // Rotate if we have at least 2 photos
    if (photos.length < 2) return

    const timer = setInterval(() => {
      setIsTransitioning(true)
      setTimeout(() => {
        setStartIndex((prev) => (prev + 1) % photos.length)
        setIsTransitioning(false)
      }, 500)
    }, rotationInterval)

    return () => clearInterval(timer)
  }, [photos.length, rotationInterval])

  if (photos.length === 0) {
    return <div className="kds-photo-strip kds-photo-strip-empty" />
  }

  // Get current window of photos (wrapping around to fill all slots)
  const currentPhotos: string[] = []
  for (let i = 0; i < displayCount; i++) {
    const idx = (startIndex + i) % photos.length
    currentPhotos.push(photos[idx])
  }

  return (
    <div className="kds-photo-strip">
      {currentPhotos.map((photo, idx) => (
        <div
          key={`${startIndex}-${idx}`}
          className="kds-photo-item"
          style={{
            opacity: isTransitioning ? 0 : 1,
            transition: 'opacity 0.5s ease',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/images/kds/photos/${photo}`}
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
      ))}
    </div>
  )
}
