/**
 * KDS Sized Item Row
 * Displays a menu item with size-based pricing columns (Tall/Grande/Venti)
 */

import type { GroupedMenuItem, SizeKey } from '@/lib/kds/group-items'
import { getSizeColumns } from '@/lib/kds/group-items'

interface KDSSizedItemRowProps {
  item: GroupedMenuItem
  animate?: boolean
}

export default function KDSSizedItemRow({ item, animate = true }: KDSSizedItemRowProps) {
  const sizes = getSizeColumns()
  const displayName = item.displayName || item.baseName

  return (
    <div className={`kds-sized-item ${animate ? 'kds-item-animate' : ''}`}>
      <span className="kds-sized-item-name">{displayName}</span>
      {sizes.map((size: SizeKey) => {
        const sizeInfo = item.sizes[size]
        return (
          <span key={size} className="kds-sized-item-price">
            {sizeInfo ? sizeInfo.price : '—'}
          </span>
        )
      })}
    </div>
  )
}
