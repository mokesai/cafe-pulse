'use client'

import type { KDSMenuItem, KDSCategoryIcon as IconType, KDSDisplayType } from '@/lib/kds/types'
import { groupItemsBySizes, hasSizedItems } from '@/lib/kds/group-items'

interface KDSCategoryCompactProps {
  name: string
  items: KDSMenuItem[]
  icon?: IconType
  /** Category-level price (e.g., "CROISSANTS $4.95") */
  categoryPrice?: string
  /** Display type for the category */
  displayType?: KDSDisplayType
  /** Custom header text (e.g., for single-price categories) */
  headerText?: string
  /** Custom size labels (default: ["Tall", "Grande", "Venti"]) */
  sizeLabels?: string[]
  /** Whether to show size column headers */
  showSizeHeader?: boolean
}

/**
 * Compact category display for the dual-panel layout.
 * Shows category name with icon and items in a dense format.
 * Supports multiple display types: featured, price-grid, simple-list, single-price, flavor-options
 */
export default function KDSCategoryCompact({
  name,
  items,
  icon,
  categoryPrice,
  displayType = 'price-grid',
  headerText,
  sizeLabels = ['Tall', 'Grande', 'Venti'],
  showSizeHeader = true,
}: KDSCategoryCompactProps) {
  // Render based on display type
  switch (displayType) {
    case 'featured':
      return renderFeaturedList(name, items, icon)
    case 'flavor-options':
      return renderFlavorGrid(name, items, icon, headerText)
    case 'simple-list':
      return renderSimpleList(name, items, icon)
    case 'single-price':
      return renderSinglePriceCategory(name, items, icon, headerText)
    case 'price-grid':
    default:
      return renderPriceGrid(name, items, icon, categoryPrice, sizeLabels, showSizeHeader)
  }
}

/**
 * Featured display: star icons with item names, no prices
 */
function renderFeaturedList(name: string, items: KDSMenuItem[], icon?: IconType) {
  return (
    <div className="kds-compact-category kds-featured-category">
      <div className="kds-compact-header">
        {icon && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/images/kds/icons/${icon}.svg`}
            alt=""
            className="kds-compact-icon"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="kds-compact-title">{name}</span>
      </div>
      <div className="kds-compact-items">
        {items.map((item) => (
          <div key={item.id} className="kds-featured-item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/kds/icons/star-gold.png"
              alt=""
              className="kds-star-icon"
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
 * Flavor grid: two-column grid with colored bullets
 */
function renderFlavorGrid(name: string, items: KDSMenuItem[], icon?: IconType, headerText?: string) {
  return (
    <div className="kds-compact-category">
      <div className="kds-compact-header">
        {icon && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/images/kds/icons/${icon}.svg`}
            alt=""
            className="kds-compact-icon"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="kds-compact-title">{name}</span>
        {headerText && (
          <span className="kds-single-price-header">{headerText}</span>
        )}
      </div>
      <div className="kds-flavor-grid">
        {items.map((item) => (
          <div key={item.id} className="kds-flavor-item">
            <span className={`kds-bullet kds-bullet-${item.bulletColor || 'green'}`} />
            <span className="kds-flavor-item-name">
              {item.displayName || item.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Simple list: item name + dotted leader + price, no size columns
 */
function renderSimpleList(name: string, items: KDSMenuItem[], icon?: IconType) {
  return (
    <div className="kds-compact-category">
      <div className="kds-compact-header">
        {icon && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/images/kds/icons/${icon}.svg`}
            alt=""
            className="kds-compact-icon"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="kds-compact-title">{name}</span>
      </div>
      <div className="kds-compact-items">
        {items.map((item) => (
          <div key={item.id} className="kds-simple-item">
            <span className="kds-simple-item-name">
              {item.displayName || item.name}
            </span>
            <span className="kds-simple-item-dots" />
            <span className="kds-simple-item-price">
              {item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Single price: category price in header, simple item list without prices
 */
function renderSinglePriceCategory(name: string, items: KDSMenuItem[], icon?: IconType, headerText?: string) {
  return (
    <div className="kds-compact-category">
      <div className="kds-compact-header">
        {icon && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/images/kds/icons/${icon}.svg`}
            alt=""
            className="kds-compact-icon"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="kds-compact-title">{name}</span>
        {headerText && (
          <span className="kds-single-price-header">{headerText}</span>
        )}
      </div>
      <div className="kds-compact-items">
        {items.map((item) => (
          <div key={item.id} className="kds-featured-item">
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
 * Price grid: items with Tall/Grande/Venti size columns
 */
function renderPriceGrid(
  name: string,
  items: KDSMenuItem[],
  icon?: IconType,
  categoryPrice?: string,
  sizeLabels: string[] = ['Tall', 'Grande', 'Venti'],
  showSizeHeader: boolean = true
) {
  const showSizeColumns = hasSizedItems(items)
  const processedItems = showSizeColumns ? groupItemsBySizes(items) : null

  return (
    <div className="kds-compact-category">
      {/* Category Header */}
      <div className="kds-compact-header">
        {icon && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/images/kds/icons/${icon}.svg`}
            alt=""
            className="kds-compact-icon"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="kds-compact-title">{name}</span>
        {categoryPrice && (
          <span className="kds-compact-category-price">{categoryPrice}</span>
        )}
      </div>

      {/* Size Column Headers (if applicable) */}
      {showSizeColumns && showSizeHeader && (
        <div className="kds-compact-size-header">
          <span></span>
          {sizeLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      )}

      {/* Items */}
      <div className="kds-compact-items">
        {showSizeColumns && processedItems
          ? processedItems.map((processed) => {
              if (processed.type === 'grouped') {
                const { item } = processed
                return (
                  <div key={item.squareItemId} className="kds-compact-sized-item">
                    <span className="kds-compact-item-name">
                      {item.displayName || item.baseName}
                    </span>
                    <span className="kds-compact-price">
                      {item.sizes.Tall?.price || '—'}
                    </span>
                    <span className="kds-compact-price">
                      {item.sizes.Grande?.price || '—'}
                    </span>
                    <span className="kds-compact-price">
                      {item.sizes.Venti?.price || '—'}
                    </span>
                  </div>
                )
              } else {
                const { item } = processed
                return (
                  <div key={item.id} className="kds-compact-item">
                    <span className="kds-compact-item-name">
                      {item.displayName || item.name}
                    </span>
                    <span className="kds-compact-item-price">{item.price}</span>
                  </div>
                )
              }
            })
          : items.map((item) => (
              <div key={item.id} className="kds-compact-item">
                <span className="kds-compact-item-name">
                  {item.displayName || item.name}
                </span>
                <span className="kds-compact-item-price">
                  {item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`}
                </span>
              </div>
            ))}
      </div>
    </div>
  )
}
