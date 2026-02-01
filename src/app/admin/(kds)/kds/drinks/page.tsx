import { getScreenData } from '@/lib/kds/queries'
import { KDSDrinksMagazine } from '@/app/kds/components'

// Revalidate every 5 minutes
export const revalidate = 300

// Header images for drinks panel
const HEADER_IMAGES = {
  leftTitleIcon: '/images/kds/header/coffee-steam-icon.png',
  rightTitleIcon: '/images/kds/header/wps-starbucks-logo.png',
}

// Inline images
const MOST_POPULAR_IMAGE = '/images/kds/photos/wps-frappuccinos.png'

// Photo strip images (stacked vertically with dividers)
const PHOTO_STRIP_IMAGES = [
  '/images/kds/photos/iced-coffee-wps.png',
  '/images/kds/photos/smoothies-wps.png',
  '/images/kds/photos/refreshers-wps.png',
]

export default async function DrinksDisplayPage() {
  const data = await getScreenData('drinks')

  return (
    <KDSDrinksMagazine
      data={data}
      headerImages={HEADER_IMAGES}
      mostPopularImage={MOST_POPULAR_IMAGE}
      photoStripImages={PHOTO_STRIP_IMAGES}
    />
  )
}
