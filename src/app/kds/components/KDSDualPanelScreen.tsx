import type { KDSScreenData } from '@/lib/kds/types'
import KDSPanelHeader from './KDSPanelHeader'
import KDSCategoryCompact from './KDSCategoryCompact'
import KDSPhotoStrip from './KDSPhotoStrip'
import KDSAutoRefresh from './KDSAutoRefresh'

interface HeaderImages {
  left?: string
  right?: string
  subtitleLogo?: string
}

interface KDSDualPanelScreenProps {
  data: KDSScreenData
  /** Panel position: 'left' for drinks, 'right' for food */
  panel: 'left' | 'right'
  /** Photos to show at bottom */
  photos?: string[]
  /** Header images: left product, right product, subtitle logo */
  headerImages?: HeaderImages
  /** Enable auto-refresh (default: true) */
  autoRefresh?: boolean
}

/**
 * Single panel of the dual-panel menu board layout.
 * Designed to be displayed on one TV, with another TV showing the other panel.
 * Together they form the complete menu board like the example.
 *
 * Left panel (drinks): Standard header with Starbucks logo
 * Right panel (food): Banner header with custom title (e.g., "LOTUS ENERGY DRINKS")
 */
export default function KDSDualPanelScreen({
  data,
  panel,
  photos = [],
  headerImages = {},
  autoRefresh = true,
}: KDSDualPanelScreenProps) {
  const { categories, settings } = data

  const cafeName = (settings.cafe_name as string) || 'Little Café'
  const refreshInterval = (settings.refresh_interval as number) || 5 * 60 * 1000
  const location = (settings.header_location as string) || 'Kaiser Permanente · Denver'
  const hours = (settings.header_hours as string) || '8AM-6PM Mon-Fri'

  // Get subtitle based on panel
  const subtitle = panel === 'left'
    ? (settings.drinks_subtitle as string) || 'We proudly serve Starbucks® coffee'
    : (settings.food_subtitle as string) || 'FOOD & SPECIALTY DRINKS'

  // Header style based on panel
  const headerStyle = panel === 'left' ? 'standard' : 'banner'

  // For banner (food) panel, use custom header text from settings
  const headerTitle = panel === 'right'
    ? (settings.food_header as string) || cafeName
    : cafeName

  // Header images
  const { left: leftImage, right: rightImage, subtitleLogo } = headerImages

  // Split categories into two columns
  const midpoint = Math.ceil(categories.length / 2)
  const leftCategories = categories.slice(0, midpoint)
  const rightCategories = categories.slice(midpoint)

  return (
    <div className="kds-panel">
      {/* Panel Header */}
      <KDSPanelHeader
        cafeName={headerTitle}
        subtitle={subtitle}
        subtitleLogo={subtitleLogo}
        leftImage={leftImage}
        rightImage={rightImage}
        location={location}
        hours={hours}
        headerStyle={headerStyle}
      />

      {/* Categories Grid - 2 columns */}
      <div className="kds-panel-content">
        <div className="kds-panel-column">
          {leftCategories.map((category) => (
            <KDSCategoryCompact
              key={category.id}
              name={category.name}
              items={category.items}
              icon={category.icon}
              displayType={category.displayType}
              headerText={category.headerText}
              sizeLabels={category.sizeLabels}
              showSizeHeader={category.showSizeHeader}
            />
          ))}
        </div>
        <div className="kds-panel-column">
          {rightCategories.map((category) => (
            <KDSCategoryCompact
              key={category.id}
              name={category.name}
              items={category.items}
              icon={category.icon}
              displayType={category.displayType}
              headerText={category.headerText}
              sizeLabels={category.sizeLabels}
              showSizeHeader={category.showSizeHeader}
            />
          ))}
        </div>
      </div>

      {/* Photo Strip */}
      <KDSPhotoStrip photos={photos} />

      {/* Auto-refresh indicator */}
      {autoRefresh && (
        <KDSAutoRefresh interval={refreshInterval} showIndicator={true} />
      )}
    </div>
  )
}
