import type { KDSMenuItem as KDSMenuItemType, KDSCategoryIcon as IconType } from '@/lib/kds/types'
import { groupItemsBySizes, hasSizedItems } from '@/lib/kds/group-items'
import KDSMenuItem from './KDSMenuItem'
import KDSCategoryIcon from './KDSCategoryIcon'
import KDSSizeHeader from './KDSSizeHeader'
import KDSSizedItemRow from './KDSSizedItemRow'

interface KDSCategorySectionProps {
  name: string
  items: KDSMenuItemType[]
  color?: string
  icon?: IconType
  /** Show a category-level price (e.g., "CROISSANTS $4.95") */
  categoryPrice?: string
  /** Use two-column layout for items */
  twoColumn?: boolean
  /** Maximum items to display */
  maxItems?: number
}

export default function KDSCategorySection({
  name,
  items,
  color,
  icon,
  categoryPrice,
  twoColumn = false,
  maxItems = 8,
}: KDSCategorySectionProps) {
  // Check if this category has sized items
  const showSizeColumns = hasSizedItems(items)

  // Group items for display
  const processedItems = showSizeColumns
    ? groupItemsBySizes(items)
    : null

  // Limit items to prevent overflow
  const totalCount = processedItems ? processedItems.length : items.length

  return (
    <div className="kds-category">
      {/* Category header with icon */}
      <div className="kds-category-header">
        {icon && <KDSCategoryIcon icon={icon} />}
        <h2
          className="kds-category-title"
          style={color ? { color } : undefined}
        >
          {name}
        </h2>
        {categoryPrice && (
          <span className="kds-category-price">{categoryPrice}</span>
        )}
      </div>

      {/* Size column header (only for categories with sized items) */}
      {showSizeColumns && <KDSSizeHeader />}

      {/* Menu items - grouped or single display */}
      <div className={`kds-category-items ${twoColumn && !showSizeColumns ? 'kds-items-grid' : ''}`}>
        {showSizeColumns && processedItems
          ? processedItems.slice(0, maxItems).map((processed) => {
              if (processed.type === 'grouped') {
                return (
                  <KDSSizedItemRow
                    key={processed.item.squareItemId}
                    item={processed.item}
                  />
                )
              } else {
                return (
                  <KDSMenuItem
                    key={processed.item.id}
                    name={processed.item.name}
                    displayName={processed.item.displayName}
                    price={processed.item.price}
                    compact={false}
                  />
                )
              }
            })
          : items.slice(0, maxItems).map((item) => (
              <KDSMenuItem
                key={item.id}
                name={item.name}
                displayName={item.displayName}
                price={item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`}
                compact={twoColumn}
              />
            ))}
        {totalCount > maxItems && (
          <div
            className="text-sm mt-2 italic"
            style={{ color: 'var(--kds-text-muted)' }}
          >
            +{totalCount - maxItems} more items
          </div>
        )}
      </div>
    </div>
  )
}
