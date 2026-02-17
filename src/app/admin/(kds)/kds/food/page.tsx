import { getScreenData } from '@/lib/kds/queries'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { KDSFoodMagazine } from '@/app/kds/components'

// Always fetch fresh data (no ISR caching)
export const dynamic = 'force-dynamic'

// Header images for food panel
const HEADER_IMAGES = {
  left: '/images/kds/header/muffins-plate.jpg',
  right: '/images/kds/header/pastries-plate.jpeg',
  leftTitleIcon: '/images/kds/header/coffee-steam-icon.png',
  rightTitleIcon: '/images/kds/header/lightning-bolt-icon.png',
}

// Inline images
const LOTUS_IMAGE = '/images/kds/photos/lotus-energy-drinks.png'
const FOOD_IMAGE = '/images/kds/photos/breakfast-foods.png'
const PASTRIES_IMAGE = '/images/kds/photos/pastries-assorted.png'

export default async function FoodDisplayPage() {
  const tenantId = await getCurrentTenantId()
  const data = await getScreenData(tenantId, 'food')

  return (
    <KDSFoodMagazine
      data={data}
      headerImages={HEADER_IMAGES}
      lotusImage={LOTUS_IMAGE}
      foodImage={FOOD_IMAGE}
      pastriesImage={PASTRIES_IMAGE}
    />
  )
}
