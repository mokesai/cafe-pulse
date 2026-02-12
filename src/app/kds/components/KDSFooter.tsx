import type { KDSImage } from '@/lib/kds/types'
import { Coffee } from 'lucide-react'
import KDSImageRotator from './KDSImageRotator'

interface KDSFooterProps {
  images: KDSImage[]
  tagline: string
  imageRotationInterval?: number
}

export default function KDSFooter({
  images,
  tagline,
  imageRotationInterval = 6000,
}: KDSFooterProps) {
  return (
    <footer className="kds-footer">
      {/* Rotating image */}
      <div className="kds-footer-image">
        <KDSImageRotator images={images} interval={imageRotationInterval} />
      </div>

      {/* Tagline */}
      <div className="kds-footer-content">
        <span className="kds-footer-tagline" style={{ color: 'var(--kds-accent)' }}>
          {tagline}
        </span>
      </div>

      {/* Decorative coffee icon */}
      <div className="kds-footer-decoration">
        <Coffee className="w-12 h-12" />
      </div>
    </footer>
  )
}
