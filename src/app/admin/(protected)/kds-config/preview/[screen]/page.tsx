import { notFound } from 'next/navigation'
import KDSPreviewClient from './KDSPreviewClient'
import KDSDynamicScreen from '@/app/kds/components/KDSDynamicScreen'

export const dynamic = 'force-dynamic'

const DRINKS_FALLBACK = {
  headerImages: {
    leftTitleIcon: '/images/kds/header/coffee-steam-icon.png',
    subtitleIcon: '/images/kds/icons/coffee-bean-gold.png',
  },
  sectionBadge: '/images/kds/header/wps-starbucks-logo.png',
  defaultSubtitle: 'Freshly Brewed, Just for You',
  mostPopularImage: '/images/kds/photos/wps-frappuccinos.png',
  photoStripImages: [
    '/images/kds/photos/iced-coffee-wps.png',
    '/images/kds/photos/smoothies-wps.png',
    '/images/kds/photos/refreshers-wps.png',
  ],
}

const FOOD_FALLBACK = {
  headerImages: {
    left: '/images/kds/header/muffins-plate.jpg',
    right: '/images/kds/header/pastries-plate.jpeg',
    leftTitleIcon: '/images/kds/header/coffee-steam-icon.png',
    rightTitleIcon: '/images/kds/header/lightning-bolt-icon.png',
  },
  lotusImage: '/images/kds/photos/lotus-energy-drinks.png',
  foodImage: '/images/kds/photos/breakfast-foods.png',
  pastriesImage: '/images/kds/photos/pastries-assorted.png',
}

interface PageProps {
  params: Promise<{ screen: string }>
}

export default async function KDSPreviewPage({ params }: PageProps) {
  const { screen: screenParam } = await params

  if (screenParam !== 'drinks' && screenParam !== 'food') {
    notFound()
  }

  const screen = screenParam as 'drinks' | 'food'
  const fallbackProps = screen === 'drinks' ? DRINKS_FALLBACK : FOOD_FALLBACK

  // KDSDynamicScreen is a server component — render it here and pass as children
  const kdsScreen = (
    <KDSDynamicScreen
      screen={screen}
      draft={true}
      autoRefresh={false}
      fallbackProps={fallbackProps}
    />
  )

  return (
    <KDSPreviewClient screen={screen}>
      {kdsScreen}
    </KDSPreviewClient>
  )
}
