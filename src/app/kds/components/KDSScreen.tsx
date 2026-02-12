import type { KDSScreenData } from '@/lib/kds/types'
import KDSHeader from './KDSHeader'
import KDSCategoryGrid from './KDSCategoryGrid'
import KDSFooter from './KDSFooter'
import KDSPromoFooter from './KDSPromoFooter'
import KDSAutoRefresh from './KDSAutoRefresh'

interface KDSScreenProps {
  data: KDSScreenData
  /** Enable auto-refresh (default: true) */
  autoRefresh?: boolean
  /** Use large promotional footer (default: false) */
  usePromoFooter?: boolean
  /** Promotional images for promo footer */
  promoImages?: string[]
}

export default function KDSScreen({
  data,
  autoRefresh = true,
  usePromoFooter = false,
  promoImages,
}: KDSScreenProps) {
  const {
    screen,
    categories,
    images,
    tagline,
    settings,
  } = data

  // Get settings with defaults
  const cafeName = (settings.cafe_name as string) || 'Little Café'
  const headerHours = (settings.header_hours as string) || '8AM-6PM Mon-Fri'
  const headerLocation = (settings.header_location as string) || 'Kaiser Permanente · Denver'
  const imageRotationInterval = (settings.image_rotation_interval as number) || 6000
  const refreshInterval = (settings.refresh_interval as number) || 5 * 60 * 1000

  // Get screen-specific subtitle
  const subtitle = screen === 'drinks'
    ? (settings.drinks_subtitle as string)
    : (settings.food_subtitle as string)

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <KDSHeader
        cafeName={cafeName}
        subtitle={subtitle}
        location={headerLocation}
        hours={headerHours}
      />

      {/* Main content - 4 category grid */}
      <KDSCategoryGrid categories={categories} />

      {/* Footer - standard or promotional */}
      {usePromoFooter ? (
        <KDSPromoFooter
          screen={screen}
          images={promoImages}
          tagline={tagline}
          rotationInterval={imageRotationInterval}
        />
      ) : (
        <KDSFooter
          images={images}
          tagline={tagline}
          imageRotationInterval={imageRotationInterval}
        />
      )}

      {/* Auto-refresh indicator */}
      {autoRefresh && (
        <KDSAutoRefresh
          interval={refreshInterval}
          showIndicator={true}
        />
      )}
    </div>
  )
}
