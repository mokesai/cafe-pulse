'use client'

import { useState, useEffect } from 'react'
import type { KDSScreen } from '@/lib/kds/types'

interface KDSPromoFooterProps {
  screen: KDSScreen
  /** Array of image filenames in /public/images/kds/promo/ */
  images?: string[]
  /** Tagline text displayed over the images */
  tagline?: string
  /** Image rotation interval in milliseconds */
  rotationInterval?: number
}

/**
 * Large promotional footer with rotating images.
 * Images are displayed full-width at the bottom of the screen.
 */
export default function KDSPromoFooter({
  screen,
  images,
  tagline,
  rotationInterval = 8000,
}: KDSPromoFooterProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Default to screen-specific banner if no images provided
  const imageList = images && images.length > 0
    ? images
    : [`${screen}-banner.png`]

  useEffect(() => {
    if (imageList.length <= 1) return

    const timer = setInterval(() => {
      setIsTransitioning(true)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % imageList.length)
        setIsTransitioning(false)
      }, 500)
    }, rotationInterval)

    return () => clearInterval(timer)
  }, [imageList.length, rotationInterval])

  const currentImage = imageList[currentIndex]
  const imageSrc = `/images/kds/promo/${currentImage}`

  return (
    <div className="kds-promo-footer">
      <div className="kds-promo-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt="Promotional image"
          style={{
            opacity: isTransitioning ? 0 : 1,
            transition: 'opacity 0.5s ease',
          }}
          onError={(e) => {
            const target = e.target as HTMLImageElement
            target.src = '/images/kds/placeholder.svg'
          }}
        />
        {/* Tagline overlay */}
        {tagline && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(90deg, rgba(0,0,0,0.4) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.4) 100%)',
            }}
          >
            <span className="kds-footer-tagline" style={{ color: 'white', textShadow: '2px 2px 8px rgba(0,0,0,0.5)' }}>
              {tagline}
            </span>
          </div>
        )}
      </div>
      {/* Image dots indicator */}
      {imageList.length > 1 && (
        <div className="kds-image-dots" style={{ position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)' }}>
          {imageList.map((_, idx) => (
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
