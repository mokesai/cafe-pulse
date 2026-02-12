'use client'

import { useState, useEffect } from 'react'
import type { KDSImage } from '@/lib/kds/types'

interface KDSImageRotatorProps {
  images: KDSImage[]
  interval?: number // milliseconds
  basePath?: string // path to images folder
}

export default function KDSImageRotator({
  images,
  interval = 6000,
  basePath = '/images/kds',
}: KDSImageRotatorProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Filter to only active images
  const activeImages = images.filter((img) => img.isActive)

  useEffect(() => {
    if (activeImages.length <= 1) return

    const timer = setInterval(() => {
      setIsTransitioning(true)

      // After fade out, change image
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % activeImages.length)
        setIsTransitioning(false)
      }, 500) // Half second for fade out
    }, interval)

    return () => clearInterval(timer)
  }, [activeImages.length, interval])

  if (activeImages.length === 0) {
    return (
      <div className="kds-image-container kds-empty">
        <span>No images</span>
      </div>
    )
  }

  const currentImage = activeImages[currentIndex]
  const imageSrc = `${basePath}/${currentImage.screen}/${currentImage.filename}`

  return (
    <div className="kds-image-container">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={currentImage.altText || 'Menu item'}
        className={`kds-image ${isTransitioning ? 'kds-fade-exit' : 'kds-fade-enter'}`}
        style={{ opacity: isTransitioning ? 0 : 1 }}
        onError={(e) => {
          // Fallback for missing images
          const target = e.target as HTMLImageElement
          target.src = '/images/kds/placeholder.svg'
        }}
      />

      {/* Image indicator dots */}
      {activeImages.length > 1 && (
        <div className="kds-image-dots">
          {activeImages.map((_, idx) => (
            <div
              key={idx}
              className={`kds-image-dot ${idx === currentIndex ? 'active' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
