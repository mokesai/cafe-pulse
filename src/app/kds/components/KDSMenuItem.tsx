interface KDSMenuItemProps {
  name: string
  displayName?: string
  price: string
  animate?: boolean
  /** Compact mode for two-column layout (no dot leaders) */
  compact?: boolean
}

export default function KDSMenuItem({
  name,
  displayName,
  price,
  animate = true,
  compact = false,
}: KDSMenuItemProps) {
  const itemName = displayName || name

  return (
    <div className={`kds-menu-item ${animate ? 'kds-item-animate' : ''}`}>
      <span className="kds-item-name">{itemName}</span>
      {!compact && <span className="kds-menu-item-dots" />}
      <span className="kds-item-price">{price}</span>
    </div>
  )
}
