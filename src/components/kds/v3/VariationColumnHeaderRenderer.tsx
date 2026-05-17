/**
 * MOK-158 / KDS v3 phase 6 — `variation_column_header` layout renderer.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T7)
 *
 * For groups where items share size variations (e.g. Hot Drinks at
 * Tall / Grande / Venti). Header row shows the canonical variation set on
 * the right; each item row shows the item name + per-column prices, with
 * blank cells for items missing a variation.
 *
 * The canonical variation set is derived via deriveCanonicalVariationSet —
 * union of variation names sorted by frequency desc (stable on tie).
 *
 * price_display_mode is NOT consulted — column pricing is the layout's
 * inherent pricing mode. The editor disables the price-display dropdown
 * when this layout is selected.
 */
import {
  deriveCanonicalVariationSet,
  formatPriceCents,
} from '@/lib/kds/v3-render-helpers'
import type { ResolvedGroup, SlotFormatting } from '@/lib/kds/v3-render'
import {
  DENSITY_TO_ROW_PADDING,
  TITLE_SIZE_CLASS,
  BODY_SIZE_FOR_TITLE,
  TITLE_ALIGN_CLASS,
} from './style-mappings'

export interface VariationColumnHeaderRendererProps {
  group: ResolvedGroup
  formatting: SlotFormatting
}

export function VariationColumnHeaderRenderer({
  group,
  formatting,
}: VariationColumnHeaderRendererProps) {
  const headerText = formatting.header_override ?? group.name
  const titleClass = `${TITLE_SIZE_CLASS[formatting.title_size]} ${TITLE_ALIGN_CLASS[formatting.title_align]}`
  const bodyClass = BODY_SIZE_FOR_TITLE[formatting.title_size]
  const rowPadding = DENSITY_TO_ROW_PADDING[formatting.density]

  const canonical = deriveCanonicalVariationSet(group.items)

  // Per-item price index: name → cents (per variation name).
  const priceByItem = group.items.map((item) => {
    const byName = new Map<string, number>()
    for (const v of item.variations) {
      if (typeof v.price_cents === 'number') byName.set(v.display_name, v.price_cents)
    }
    return byName
  })

  return (
    <div className="flex h-full w-full flex-col px-4 py-3 text-[color:var(--kds-text)]">
      <div className={`mb-2 flex items-baseline justify-between ${titleClass}`}>
        <h2 className="font-bold">{headerText}</h2>
        {canonical.length > 0 && (
          <div
            className={`grid gap-3 font-semibold text-[color:var(--kds-text-secondary)] ${bodyClass}`}
            style={{ gridTemplateColumns: `repeat(${canonical.length}, minmax(0, 1fr))` }}
          >
            {canonical.map((name) => (
              <span key={name} className="text-right">
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
      <ul className={`flex-1 ${bodyClass}`}>
        {group.items.map((item, idx) => (
          <li
            key={item.id}
            className={`flex items-baseline gap-3 ${rowPadding} border-b border-[color:var(--kds-divider)] last:border-b-0`}
          >
            <span className="flex-1 truncate">{item.display_name}</span>
            {canonical.length > 0 && (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${canonical.length}, minmax(0, 1fr))` }}
              >
                {canonical.map((name) => {
                  const cents = priceByItem[idx].get(name)
                  return (
                    <span
                      key={name}
                      className="text-right font-medium text-[color:var(--kds-price)]"
                    >
                      {typeof cents === 'number' ? formatPriceCents(cents) : ''}
                    </span>
                  )
                })}
              </div>
            )}
          </li>
        ))}
        {group.items.length === 0 && (
          <li className="text-[color:var(--kds-text-muted)] italic">
            (no items)
          </li>
        )}
      </ul>
    </div>
  )
}
