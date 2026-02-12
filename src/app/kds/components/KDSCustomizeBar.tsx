interface KDSCustomizeBarProps {
  /** Text to display after "CUSTOMIZE:" label */
  text: string
}

/**
 * Customize options bar displayed below the menu grid.
 * Shows customization options like milk alternatives, extra shots, etc.
 */
export default function KDSCustomizeBar({ text }: KDSCustomizeBarProps) {
  return (
    <div className="kds-customize-bar">
      {/* Customize icon */}
      <div className="kds-customize-icon">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/kds/icons/customize.svg"
          alt=""
          aria-hidden="true"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <span className="kds-customize-label">CUSTOMIZE:</span>
      <span className="kds-customize-text">{text}</span>
    </div>
  )
}
