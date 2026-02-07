'use client'

import type { KDSScreenData, KDSCategoryWithItems, KDSMenuItem } from '@/lib/kds/types'
import KDSPanelHeader from './KDSPanelHeader'
import KDSAutoRefresh from './KDSAutoRefresh'

interface HeaderImages {
  left?: string
  right?: string
  subtitleLogo?: string
  leftTitleIcon?: string
  rightTitleIcon?: string
}

interface KDSDrinksMagazineProps {
  data: KDSScreenData
  /** Header images: left product, right product, subtitle logo */
  headerImages?: HeaderImages
  /** Image to show beside Most Popular section (Starbucks frappuccinos) */
  mostPopularImage?: string
  /** Photos for center photo strip (stacked vertically with dividers) */
  photoStripImages?: string[]
  /** Enable auto-refresh (default: true) */
  autoRefresh?: boolean
}

/**
 * Magazine-style layout for the Drinks screen (Screen 1).
 * 4-column layout:
 * - Column 1: Most Popular + Iced Favorites
 * - Column 2: Espresso & Coffee
 * - Photo Strip: Stacked drink images with dividers
 * - Column 3: Frappuccinos
 */
export default function KDSDrinksMagazine({
  data,
  headerImages = {},
  mostPopularImage = '/images/kds/photos/starbucks-frappuccinos.png',
  photoStripImages = [
    '/images/kds/photos/iced-coffee-wps.png',
    '/images/kds/photos/smoothies-wps.png',
    '/images/kds/photos/refreshers-wps.png',
  ],
  autoRefresh = true,
}: KDSDrinksMagazineProps) {
  const { categories, settings } = data

  const cafeName = (settings.cafe_name as string) || 'Little Cafe'
  const refreshInterval = (settings.refresh_interval as number) || 5 * 60 * 1000
  const location = (settings.header_location as string) || 'Kaiser Permanente · Denver'
  const hours = (settings.header_hours as string) || '8AM-6PM Mon-Fri'
  // Per WPS Starbucks Logo Requirements: Don't recreate "We Proudly Serve" text separately
  // The WPS logo already contains this text - subtitle should be empty or minimal
  const subtitle = (settings.drinks_subtitle as string) || ''

  const { left: leftImage, right: rightImage, subtitleLogo, leftTitleIcon, rightTitleIcon } = headerImages

  // Extract categories by slug
  const getCategoryBySlug = (slug: string): KDSCategoryWithItems | undefined =>
    categories.find(c => c.slug === slug)

  // Column 1 categories
  const mostPopularCategory = getCategoryBySlug('most-popular')
  const icedFavoritesCategory = getCategoryBySlug('iced-favorites')

  // Column 2 categories
  const espressoCategory = getCategoryBySlug('espresso-coffee')

  // Column 3 categories
  const frappuccinosCategory = getCategoryBySlug('frappuccinos')

  return (
    <div className="kds-panel">
      {/* Panel Header */}
      <KDSPanelHeader
        cafeName={cafeName}
        subtitle={subtitle}
        subtitleLogo={subtitleLogo}
        leftImage={leftImage}
        rightImage={rightImage}
        leftTitleIcon={leftTitleIcon}
        rightTitleIcon={rightTitleIcon}
        location={location}
        hours={hours}
        headerStyle="standard"
      />

      {/* Magazine Grid Layout - 4 columns with photo strip */}
      <div className="kds-magazine-content kds-magazine-content-4col">

        {/* Column 1: Most Popular + Iced Favorites */}
        <div className="kds-magazine-column">
          {/* Most Popular with Starbucks frappuccinos image side-by-side */}
          <div className="kds-category-row">
            {mostPopularCategory && (
              <MostPopularSection category={mostPopularCategory} />
            )}
            <div className="kds-inline-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mostPopularImage}
                alt="Starbucks Frappuccinos"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/images/kds/placeholder.svg'
                }}
              />
            </div>
          </div>

          {icedFavoritesCategory && (
            <SizedCategorySection category={icedFavoritesCategory} />
          )}
        </div>

        {/* Column 2: Espresso & Coffee */}
        <div className="kds-magazine-column">
          {espressoCategory && (
            <SizedCategorySection category={espressoCategory} />
          )}
        </div>

        {/* Photo Strip: Stacked images with elegant dividers */}
        <div className="kds-drinks-photo-strip">
          {photoStripImages.map((src, idx) => (
            <div key={idx} className="kds-photo-strip-item">
              {idx > 0 && (
                <div className="kds-photo-strip-divider-css">
                  <span className="kds-divider-line" />
                  <span className="kds-divider-diamond" />
                  <span className="kds-divider-line" />
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                className="kds-photo-strip-image"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/images/kds/placeholder.svg'
                }}
              />
            </div>
          ))}
        </div>

        {/* Column 3: Frappuccinos */}
        <div className="kds-magazine-column">
          {frappuccinosCategory && (
            <SizedCategorySection category={frappuccinosCategory} />
          )}
        </div>
      </div>

      {/* Auto-refresh indicator */}
      {autoRefresh && (
        <KDSAutoRefresh interval={refreshInterval} showIndicator={true} />
      )}
    </div>
  )
}

/**
 * Most Popular section with yellow star bullets and stars flanking the title
 */
function MostPopularSection({ category }: { category: KDSCategoryWithItems }) {
  return (
    <div className="kds-magazine-category kds-most-popular">
      <div className="kds-most-popular-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/star-yellow.png"
          alt=""
          className="kds-most-popular-star"
        />
        <span className="kds-most-popular-title">{category.name}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/star-yellow.png"
          alt=""
          className="kds-most-popular-star"
        />
      </div>

      <div className="kds-featured-items">
        {category.items.map((item) => (
          <div key={item.id} className="kds-featured-item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/kds/icons/star-yellow.png"
              alt=""
              className="kds-star-bullet"
            />
            <span className="kds-featured-item-name">
              {item.displayName || item.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Category with size variations (Tall/Grande/Venti) - consolidated
 * Grande column is highlighted with bold styling
 */
function SizedCategorySection({ category }: { category: KDSCategoryWithItems }) {
  const sizeLabels = category.sizeLabels || ['Tall', 'Grande', 'Venti']

  return (
    <div className="kds-magazine-category">
      <div className="kds-magazine-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/images/kds/icons/${category.icon || 'coffee'}.svg`}
          alt=""
          className="kds-magazine-icon"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/images/kds/icons/coffee.svg'
          }}
        />
        <span className="kds-magazine-title">{category.name}</span>
      </div>

      {/* Size header - Grande is highlighted */}
      <div className="kds-compact-size-header" style={{ gridTemplateColumns: `1fr repeat(${sizeLabels.length}, 3.5rem)` }}>
        <span></span>
        {sizeLabels.map((label, i) => (
          <span key={i} className={isGrande(label) ? 'kds-size-grande' : ''}>{label}</span>
        ))}
      </div>

      <div className="kds-magazine-items">
        <ConsolidatedSizedItems items={category.items} sizeLabels={sizeLabels} />
      </div>
    </div>
  )
}

/**
 * Consolidate items by display name, grouping size variations together
 */
function consolidateItems(items: KDSMenuItem[], sizeLabels: string[]): { name: string; prices: (string | null)[] }[] {
  const itemMap = new Map<string, (string | null)[]>()

  // Build a map of item names to their prices by size
  // Group by base name (item.name) which doesn't include size suffix,
  // but display using displayName if it doesn't contain size info
  for (const item of items) {
    // Use base name for grouping (e.g., "Americano" not "Americano (Tall)")
    const groupKey = item.name
    const variationName = item.variationName?.toLowerCase() || ''

    if (!itemMap.has(groupKey)) {
      // Initialize with nulls for each size
      itemMap.set(groupKey, Array(sizeLabels.length).fill(null))
    }

    const prices = itemMap.get(groupKey)!

    // Find which size column this variation belongs to
    for (let i = 0; i < sizeLabels.length; i++) {
      const label = sizeLabels[i].toLowerCase()
      if (variationName.includes(label) || variationName === label) {
        prices[i] = item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`
        break
      }
    }

    // If no match found, put price in first empty slot (fallback)
    if (!prices.some(p => p !== null)) {
      prices[0] = item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`
    }
  }

  // Convert map to array, preserving order from first occurrence
  const seen = new Set<string>()
  const result: { name: string; prices: (string | null)[] }[] = []

  for (const item of items) {
    const groupKey = item.name
    if (!seen.has(groupKey)) {
      seen.add(groupKey)
      result.push({ name: groupKey, prices: itemMap.get(groupKey)! })
    }
  }

  return result
}

/**
 * Check if a size label is "Grande" (case-insensitive)
 */
function isGrande(label: string): boolean {
  return label.toLowerCase() === 'grande'
}

/**
 * Consolidated sized items display (for espresso, frappuccinos, etc.)
 * Highlights Grande prices with bold styling
 */
function ConsolidatedSizedItems({ items, sizeLabels }: { items: KDSMenuItem[]; sizeLabels: string[] }) {
  const consolidated = consolidateItems(items, sizeLabels)

  return (
    <>
      {consolidated.map((item, idx) => (
        <div key={idx} className="kds-compact-sized-item" style={{ gridTemplateColumns: `1fr repeat(${sizeLabels.length}, 3.5rem)` }}>
          <span className="kds-compact-item-name">{item.name}</span>
          {item.prices.map((price, i) => (
            <span
              key={i}
              className={`kds-compact-price ${isGrande(sizeLabels[i]) ? 'kds-price-grande' : ''}`}
            >
              {price || '—'}
            </span>
          ))}
        </div>
      ))}
    </>
  )
}
