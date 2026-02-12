import type { KDSCategoryWithItems, KDSPosition } from '@/lib/kds/types'
import KDSCategorySection from './KDSCategorySection'

interface KDSCategoryGridProps {
  categories: KDSCategoryWithItems[]
}

export default function KDSCategoryGrid({ categories }: KDSCategoryGridProps) {
  // Map categories to their positions
  const getByPosition = (position: KDSPosition): KDSCategoryWithItems | undefined => {
    return categories.find((cat) => cat.position === position)
  }

  const topLeft = getByPosition('top-left')
  const topRight = getByPosition('top-right')
  const bottomLeft = getByPosition('bottom-left')
  const bottomRight = getByPosition('bottom-right')

  return (
    <div className="kds-grid">
      {/* Top Left */}
      <div className="kds-grid-cell">
        {topLeft ? (
          <KDSCategorySection
            name={topLeft.name}
            items={topLeft.items}
            color={topLeft.color}
            icon={topLeft.icon}
            maxItems={12}
          />
        ) : (
          <EmptyQuadrant />
        )}
      </div>

      {/* Top Right */}
      <div className="kds-grid-cell">
        {topRight ? (
          <KDSCategorySection
            name={topRight.name}
            items={topRight.items}
            color={topRight.color}
            icon={topRight.icon}
            maxItems={12}
          />
        ) : (
          <EmptyQuadrant />
        )}
      </div>

      {/* Bottom Left */}
      <div className="kds-grid-cell">
        {bottomLeft ? (
          <KDSCategorySection
            name={bottomLeft.name}
            items={bottomLeft.items}
            color={bottomLeft.color}
            icon={bottomLeft.icon}
            maxItems={12}
          />
        ) : (
          <EmptyQuadrant />
        )}
      </div>

      {/* Bottom Right */}
      <div className="kds-grid-cell">
        {bottomRight ? (
          <KDSCategorySection
            name={bottomRight.name}
            items={bottomRight.items}
            color={bottomRight.color}
            icon={bottomRight.icon}
            maxItems={12}
          />
        ) : (
          <EmptyQuadrant />
        )}
      </div>
    </div>
  )
}

function EmptyQuadrant() {
  return <div className="kds-empty">No items</div>
}
