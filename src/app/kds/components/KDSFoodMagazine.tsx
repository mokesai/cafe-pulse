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

interface KDSFoodMagazineProps {
  data: KDSScreenData
  /** Header images: left product, right product, subtitle logo, title icons */
  headerImages?: HeaderImages
  /** Image to show beside Lotus Energy section */
  lotusImage?: string
  /** Image to show at bottom of food column (column 3) */
  foodImage?: string
  /** Image to show at bottom of pastries column (column 2) */
  pastriesImage?: string
  /** Enable auto-refresh (default: true) */
  autoRefresh?: boolean
}

/**
 * Magazine-style layout for the Food screen (Screen 2).
 * 3-column layout:
 * - Column 1: Lotus Energy + Smoothies + Other Favorites
 * - Column 2: Teas + Fresh Pastries
 * - Column 3: Perfect with Grande Coffee + food image
 */
export default function KDSFoodMagazine({
  data,
  headerImages = {},
  lotusImage = '/images/kds/photos/lotus-energy-drinks.png',
  foodImage = '/images/kds/photos/breakfast-foods.png',
  pastriesImage = '/images/kds/photos/pastries-assorted.png',
  autoRefresh = true,
}: KDSFoodMagazineProps) {
  const { categories, settings } = data

  const cafeName = (settings.cafe_name as string) || 'Little Café'
  const refreshInterval = (settings.refresh_interval as number) || 5 * 60 * 1000
  const location = (settings.header_location as string) || 'Kaiser Permanente · Denver'
  const hours = (settings.header_hours as string) || '8AM-6PM Mon-Fri'
  const subtitle = (settings.food_subtitle as string) || 'FOOD & SPECIALTY DRINKS'
  const headerTitle = (settings.food_header as string) || cafeName

  const { left: leftImage, right: rightImage, leftTitleIcon, rightTitleIcon } = headerImages

  // Extract categories by slug
  const getCategoryBySlug = (slug: string): KDSCategoryWithItems | undefined =>
    categories.find(c => c.slug === slug)

  // Column 1 categories
  const lotusCategory = getCategoryBySlug('lotus-energy')
  const flavorsCategory = getCategoryBySlug('lotus-flavors')
  const smoothiesCategory = getCategoryBySlug('smoothies')
  const favoritesCategory = getCategoryBySlug('other-favorites')

  // Column 2 categories
  const teasCategory = getCategoryBySlug('teas')
  const pastriesCategory = getCategoryBySlug('fresh-pastries')

  // Column 3 categories
  const foodCategory = getCategoryBySlug('coffee-pairings') || getCategoryBySlug('food-pairings')

  return (
    <div className="kds-panel">
      {/* Panel Header */}
      <KDSPanelHeader
        cafeName={headerTitle}
        subtitle={subtitle}
        leftImage={leftImage}
        rightImage={rightImage}
        leftTitleIcon={leftTitleIcon}
        rightTitleIcon={rightTitleIcon}
        location={location}
        hours={hours}
        headerStyle="banner"
      />

      {/* Magazine Grid Layout - 3 columns with mixed content */}
      <div className="kds-magazine-content">

        {/* Column 1: Lotus Energy + Smoothies + Other Favorites */}
        <div className="kds-magazine-column">
          {/* Lotus Energy section with image beside it */}
          <div className="kds-category-row">
            <LotusSection
              lotus={lotusCategory}
              flavors={flavorsCategory}
            />
            <div className="kds-inline-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lotusImage}
                alt="Lotus Energy Drinks"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/images/kds/placeholder.svg'
                }}
              />
            </div>
          </div>

          {/* Smoothies */}
          {smoothiesCategory && (
            <SmoothiesSection category={smoothiesCategory} />
          )}

          {/* Other Favorites (no thumbnail) */}
          {favoritesCategory && (
            <FavoritesSection category={favoritesCategory} />
          )}
        </div>

        {/* Column 2: Teas + Fresh Pastries + Pastries Image */}
        <div className="kds-magazine-column">
          {teasCategory && (
            <TeasSection category={teasCategory} />
          )}

          {pastriesCategory && (
            <PastriesSection category={pastriesCategory} />
          )}

          {/* Pastries image at bottom of column */}
          <div className="kds-inline-image kds-inline-image-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pastriesImage}
              alt="Fresh pastries and cookies"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/images/kds/placeholder.svg'
              }}
            />
          </div>
        </div>

        {/* Column 3: Food Pairings with image */}
        <div className="kds-magazine-column">
          {foodCategory && (
            <FoodPairingsSection category={foodCategory} />
          )}

          {/* Breakfast foods image at bottom of column */}
          <div className="kds-inline-image kds-inline-image-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={foodImage}
              alt="Breakfast burrito, sandwich, and empanadas"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/images/kds/placeholder.svg'
              }}
            />
          </div>
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
 * Combined Lotus Energy + Flavors section
 */
function LotusSection({
  lotus,
  flavors
}: {
  lotus?: KDSCategoryWithItems
  flavors?: KDSCategoryWithItems
}) {
  if (!lotus) return null

  // Get price from lotus category header or first item
  const price = lotus.headerText || (lotus.items[0]
    ? `$${(lotus.items[0].priceCents / 100).toFixed(2)}`
    : '')

  // Combine flavor items from both categories
  const flavorItems = flavors?.items || []

  return (
    <div className="kds-lotus-section">
      <div className="kds-lotus-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/bolt.png"
          alt=""
          className="kds-lotus-icon"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/images/kds/icons/lotus.svg'
          }}
        />
        <span className="kds-lotus-title">Lotus Energy</span>
      </div>
      <div className="kds-lotus-price">{price}</div>

      {flavorItems.length > 0 && (
        <>
          <div className="kds-lotus-subtitle">Popular Flavors:</div>
          <div className="kds-lotus-flavors">
            {flavorItems.map((item) => (
              <div key={item.id} className="kds-lotus-flavor">
                <span className={`kds-bullet kds-bullet-${item.bulletColor || 'blue'}`} />
                <span className="kds-lotus-flavor-name">
                  {item.displayName || item.name}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Smoothies section with size columns (consolidated)
 */
function SmoothiesSection({ category }: { category: KDSCategoryWithItems }) {
  const sizeLabels = category.sizeLabels || ['Tall', 'Venti']

  return (
    <div className="kds-magazine-category">
      <div className="kds-magazine-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/blender.png"
          alt=""
          className="kds-magazine-icon"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/images/kds/icons/frappuccino.svg'
          }}
        />
        <span className="kds-magazine-title">{category.name}</span>
      </div>

      {/* Size header */}
      <div className="kds-compact-size-header" style={{ gridTemplateColumns: `1fr repeat(${sizeLabels.length}, 3.5rem)` }}>
        <span></span>
        {sizeLabels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>

      <div className="kds-magazine-items">
        <ConsolidatedSizedItems items={category.items} sizeLabels={sizeLabels} />
      </div>
    </div>
  )
}

/**
 * Teas section with size columns (Tall/Grande/Venti) - consolidated
 * Grande column is highlighted with bold styling
 */
function TeasSection({ category }: { category: KDSCategoryWithItems }) {
  const sizeLabels = category.sizeLabels || ['Tall', 'Grande', 'Venti']

  return (
    <div className="kds-magazine-category">
      <div className="kds-magazine-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/tea.svg"
          alt=""
          className="kds-magazine-icon"
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
 * Fresh Pastries section (simple list)
 */
function PastriesSection({ category }: { category: KDSCategoryWithItems }) {
  return (
    <div className="kds-magazine-category">
      <div className="kds-magazine-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/croissant.svg"
          alt=""
          className="kds-magazine-icon"
        />
        <span className="kds-magazine-title">{category.name}</span>
      </div>

      <div className="kds-magazine-items">
        {category.items.map((item) => (
          <div key={item.id} className="kds-tight-item">
            <span className="kds-tight-item-name">
              {item.displayName || item.name}
            </span>
            <span className="kds-tight-item-price">
              {item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`}
            </span>
          </div>
        ))}
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
  for (const item of items) {
    const name = item.displayName || item.name
    const variationName = item.variationName?.toLowerCase() || ''

    if (!itemMap.has(name)) {
      // Initialize with nulls for each size
      itemMap.set(name, Array(sizeLabels.length).fill(null))
    }

    const prices = itemMap.get(name)!

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
    const name = item.displayName || item.name
    if (!seen.has(name)) {
      seen.add(name)
      result.push({ name, prices: itemMap.get(name)! })
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
 * Consolidated sized items display (for smoothies, teas, etc.)
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

/**
 * Food Pairings section with tight spacing and icon in header
 */
function FoodPairingsSection({ category }: { category: KDSCategoryWithItems }) {
  return (
    <div className="kds-food-pairings">
      <div className="kds-food-pairings-header-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/fork-knife-icon.png"
          alt=""
          className="kds-food-pairings-icon"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/images/kds/icons/croissant.svg'
          }}
        />
        <span className="kds-food-pairings-header">
          Perfect with your Grande Coffee
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/coffee-cup-icon.png"
          alt=""
          className="kds-food-pairings-icon"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/images/kds/icons/coffee.svg'
          }}
        />
      </div>
      <div className="kds-food-pairings-items">
        {category.items.map((item) => (
          <div key={item.id} className="kds-tight-item">
            <span className="kds-tight-item-name">
              {item.displayName || item.name}
            </span>
            <span className="kds-tight-item-price">
              {item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Other Favorites section (consolidated, no thumbnail)
 */
function FavoritesSection({ category }: { category: KDSCategoryWithItems }) {
  const sizeLabels = category.sizeLabels || ['Serene', 'Venti']

  return (
    <div className="kds-magazine-category">
      <div className="kds-magazine-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/heart.png"
          alt=""
          className="kds-magazine-icon"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/images/kds/icons/chocolate.svg'
          }}
        />
        <span className="kds-magazine-title">{category.name}</span>
      </div>

      {/* Size header */}
      <div className="kds-compact-size-header" style={{ gridTemplateColumns: `1fr repeat(${sizeLabels.length}, 3.5rem)` }}>
        <span></span>
        {sizeLabels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>

      <div className="kds-magazine-items">
        <ConsolidatedSizedItems items={category.items} sizeLabels={sizeLabels} />
      </div>
    </div>
  )
}
