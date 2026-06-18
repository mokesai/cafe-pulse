/**
 * MOK-158 / KDS v3 phase 6 — `flavor_list` layout renderer.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T8)
 *
 * For items with flavor variations sharing one price (canonical example:
 * Muffin / Blueberry • Banana Walnut • Lemon Poppyseed • Chocolate Chip /
 * $4.25). Per item: bold name on line 1, flavor variations joined with
 * " • " on line 2, optional price on the right.
 *
 * Price text comes from derivePriceText — typically operator picks 'base'
 * or 'lowest' for this layout. Density controls inter-item spacing.
 */
import { derivePriceText } from '@/lib/kds/v3-render-helpers'
import type { ResolvedGroup, SlotFormatting } from '@/lib/kds/v3-render'
import {
  DENSITY_TO_ROW_PADDING,
  TITLE_SIZE_CLASS,
  BODY_SIZE_FOR_TITLE,
  TITLE_ALIGN_CLASS,
} from './style-mappings'

export interface FlavorListRendererProps {
  group: ResolvedGroup
  formatting: SlotFormatting
}

export function FlavorListRenderer({ group, formatting }: FlavorListRendererProps) {
  const headerText = formatting.header_override ?? group.name
  const titleClass = `${TITLE_SIZE_CLASS[formatting.title_size]} ${TITLE_ALIGN_CLASS[formatting.title_align]}`
  const bodyClass = BODY_SIZE_FOR_TITLE[formatting.title_size]
  const rowPadding = DENSITY_TO_ROW_PADDING[formatting.density]

  return (
    <div className="flex h-full w-full flex-col px-4 py-3 text-[color:var(--kds-text)]">
      <h2 className={`font-bold ${titleClass} mb-3`}>{headerText}</h2>
      <ul className={`flex-1 ${bodyClass}`}>
        {group.items.map((item) => {
          const flavors = item.variations.map((v) => v.display_name).join(' • ')
          const price = derivePriceText(formatting.price_display_mode, item.variations)
          return (
            <li
              key={item.id}
              className={`${rowPadding} border-b border-[color:var(--kds-divider)] last:border-b-0`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{item.display_name}</span>
                {price && (
                  <span className="font-semibold text-[color:var(--kds-price)]">{price}</span>
                )}
              </div>
              {flavors && (
                <div className="mt-0.5 text-[color:var(--kds-text-secondary)]">{flavors}</div>
              )}
            </li>
          )
        })}
        {group.items.length === 0 && (
          <li className="text-[color:var(--kds-text-muted)] italic">
            (no items)
          </li>
        )}
      </ul>
    </div>
  )
}
