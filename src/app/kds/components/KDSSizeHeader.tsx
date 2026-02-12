/**
 * KDS Size Column Header
 * Displays the column headers for Tall/Grande/Venti pricing
 */

import { getSizeColumns } from '@/lib/kds/group-items'

interface KDSSizeHeaderProps {
  animate?: boolean
  /** Custom size labels (default: ["Tall", "Grande", "Venti"]) */
  labels?: string[]
}

export default function KDSSizeHeader({ animate = true, labels }: KDSSizeHeaderProps) {
  // Use custom labels if provided, otherwise fall back to default size columns
  const sizeLabels = labels || getSizeColumns()

  return (
    <div className={`kds-size-header ${animate ? 'kds-item-animate' : ''}`}>
      <span className="kds-size-header-spacer" />
      {sizeLabels.map((size, index) => (
        <span key={index} className="kds-size-header-label">
          {size}
        </span>
      ))}
    </div>
  )
}
