'use client'

import type { KDSCategoryIcon as IconType } from '@/lib/kds/types'

interface KDSCategoryIconProps {
  icon: IconType
  className?: string
}

/**
 * Renders a category icon from the KDS icon set.
 * Icons are stored as SVGs in /public/images/kds/icons/
 */
export default function KDSCategoryIcon({ icon, className = '' }: KDSCategoryIconProps) {
  const iconPath = `/images/kds/icons/${icon}.svg`

  return (
    <div className={`kds-category-icon ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={iconPath}
        alt=""
        aria-hidden="true"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
        onError={(e) => {
          // Hide if icon not found
          const target = e.target as HTMLImageElement
          target.style.display = 'none'
        }}
      />
    </div>
  )
}
