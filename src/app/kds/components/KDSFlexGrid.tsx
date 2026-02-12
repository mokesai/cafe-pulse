import type { KDSCategoryWithItems } from '@/lib/kds/types'
import KDSCategorySection from './KDSCategorySection'

interface KDSFlexGridProps {
  categories: KDSCategoryWithItems[]
  /** Number of columns (default: 2) */
  columns?: 2 | 3 | 4
  /** Use two-column layout within each category */
  twoColumnItems?: boolean
}

/**
 * Flexible grid layout for categories.
 * Categories are arranged in order by sortOrder, filling columns left-to-right.
 */
export default function KDSFlexGrid({
  categories,
  columns = 2,
  twoColumnItems = false,
}: KDSFlexGridProps) {
  // Sort categories by sortOrder
  const sortedCategories = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)

  // Calculate rows needed
  const rows = Math.ceil(sortedCategories.length / columns)

  // Grid template based on columns
  const gridStyle = {
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
  }

  return (
    <div className="kds-grid" style={gridStyle}>
      {sortedCategories.map((category) => (
        <div key={category.id} className="kds-grid-cell">
          <KDSCategorySection
            name={category.name}
            items={category.items}
            color={category.color}
            icon={category.icon}
            twoColumn={twoColumnItems}
          />
        </div>
      ))}
      {/* Fill empty cells if needed */}
      {Array.from({ length: rows * columns - sortedCategories.length }).map((_, idx) => (
        <div key={`empty-${idx}`} className="kds-grid-cell">
          <div className="kds-empty">No items</div>
        </div>
      ))}
    </div>
  )
}
