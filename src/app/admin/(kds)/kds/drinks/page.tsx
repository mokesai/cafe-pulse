import KDSDynamicScreen from '@/app/kds/components/KDSDynamicScreen'

// Always fetch fresh data (no ISR caching)
export const dynamic = 'force-dynamic'

// Header images for drinks panel
const HEADER_IMAGES = {
  leftTitleIcon: '/images/kds/header/coffee-steam-icon.png',
  subtitleIcon: '/images/kds/icons/coffee-bean-gold.png',
}

// WPS Starbucks siren logo - displayed as section badge (brand compliance: separate from operator identity)
const SECTION_BADGE = '/images/kds/header/wps-starbucks-logo.png'

// Default subtitle (can be overridden by drinks_subtitle DB setting)
const DEFAULT_SUBTITLE = 'Freshly Brewed, Just for You'

// Inline images
const MOST_POPULAR_IMAGE = '/images/kds/photos/wps-frappuccinos.png'

// Photo strip images (stacked vertically with dividers)
const PHOTO_STRIP_IMAGES = [
  '/images/kds/photos/iced-coffee-wps.png',
  '/images/kds/photos/smoothies-wps.png',
  '/images/kds/photos/refreshers-wps.png',
]

export default function DrinksDisplayPage() {
  return (
    <KDSDynamicScreen
      screen="drinks"
      fallbackProps={{
        headerImages: HEADER_IMAGES,
        sectionBadge: SECTION_BADGE,
        defaultSubtitle: DEFAULT_SUBTITLE,
        mostPopularImage: MOST_POPULAR_IMAGE,
        photoStripImages: PHOTO_STRIP_IMAGES,
      }}
    />
  )
}
