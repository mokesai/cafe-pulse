import { Coffee } from 'lucide-react'

interface KDSHeaderProps {
  cafeName?: string
  subtitle?: string
  location?: string
  hours?: string
}

export default function KDSHeader({
  cafeName = 'Little Café',
  subtitle,
  location = 'Kaiser Permanente · Denver',
  hours = '8AM-6PM Mon-Fri',
}: KDSHeaderProps) {
  return (
    <header className="kds-header">
      {/* Logo and cafe name */}
      <div className="kds-header-brand">
        {/* Icon for dark theme (hidden in warm theme via CSS) */}
        <div className="kds-header-icon">
          <Coffee className="w-7 h-7 text-white" />
        </div>
        {/* Script logo and subtitle */}
        <div>
          <span className="kds-header-logo">{cafeName}</span>
          {subtitle && (
            <div className="kds-header-subtitle">{subtitle}</div>
          )}
        </div>
      </div>

      {/* Location */}
      <div className="kds-header-text">
        {location}
      </div>

      {/* Hours */}
      <div className="kds-header-text">
        {hours}
      </div>
    </header>
  )
}
