'use client'

interface KDSPanelHeaderProps {
  cafeName: string
  subtitle?: string
  subtitleLogo?: string // Optional logo image to display before subtitle text
  subtitleIcon?: string // Decorative icon flanking the subtitle text (left & right)
  leftImage?: string // Product image for left side
  rightImage?: string // Product image for right side
  leftTitleIcon?: string // Icon to display left of title (banner style)
  rightTitleIcon?: string // Icon to display right of title (banner style)
  location?: string
  hours?: string
  /** Header style: 'standard' for drinks screen, 'banner' for food screen */
  headerStyle?: 'standard' | 'banner'
}

/**
 * Panel header matching cafe-menu-example design.
 *
 * Standard style:
 *   Layout: [left product image] | [centered title + subtitle] | [right product image]
 *   Bottom row: location left, hours right
 *
 * Banner style:
 *   Layout: [centered title only, no images]
 *   Dark background, uppercase title
 *   Bottom row: location left, hours right
 */
export default function KDSPanelHeader({
  cafeName,
  subtitle,
  subtitleLogo,
  subtitleIcon,
  leftImage,
  rightImage,
  leftTitleIcon,
  rightTitleIcon,
  location,
  hours,
  headerStyle = 'standard',
}: KDSPanelHeaderProps) {
  const isBanner = headerStyle === 'banner'

  return (
    <div className={`kds-panel-header ${isBanner ? 'kds-panel-header-banner' : ''}`}>
      {/* Main banner row with images and centered text */}
      <div className="kds-panel-header-main">
        {/* Left product image (standard only) */}
        {!isBanner && (
          <div className="kds-panel-header-image kds-panel-header-image-left">
            {leftImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={leftImage}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
          </div>
        )}

        {/* Centered title and subtitle */}
        <div className="kds-panel-header-center">
          <h1 className="kds-panel-logo">
            {leftTitleIcon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={leftTitleIcon}
                alt=""
                className={isBanner ? 'kds-banner-title-icon kds-banner-title-icon-left' : 'kds-standard-title-icon kds-standard-title-icon-left'}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
            <span>{cafeName}</span>
            {rightTitleIcon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={rightTitleIcon}
                alt=""
                className={isBanner ? 'kds-banner-title-icon kds-banner-title-icon-right' : 'kds-standard-title-icon kds-standard-title-icon-right'}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
          </h1>
          {!isBanner && subtitle && (
            <p className="kds-panel-subtitle">
              {subtitleIcon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={subtitleIcon}
                  alt=""
                  className="kds-panel-subtitle-flank kds-panel-subtitle-flank-left"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              )}
              <span>{subtitle}</span>
              {subtitleIcon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={subtitleIcon}
                  alt=""
                  className="kds-panel-subtitle-flank kds-panel-subtitle-flank-right"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              )}
            </p>
          )}
        </div>

        {/* Right product image (standard only) */}
        {!isBanner && (
          <div className="kds-panel-header-image kds-panel-header-image-right">
            {rightImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={rightImage}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Bottom row: location left, hours right */}
      {(location || hours) && (
        <div className="kds-panel-header-bottom">
          <span className="kds-panel-location">{location || ''}</span>
          <span className="kds-panel-hours">{hours || ''}</span>
        </div>
      )}
    </div>
  )
}
