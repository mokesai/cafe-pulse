/**
 * MOK-158 / KDS v3 phase 6 — `compact_list` layout renderer.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T9)
 *
 * For narrow-column item lists with a group-level price range header.
 * Canonical example: Energy Drinks · $5.95 / • Peach / • Berry / • Mango /
 * • Passion Fruit. Useful in split menu groups where the right half is an
 * image and the left half needs a compact narrow list.
 *
 * Header: "<group name> · <price range>". The range is auto-derived from
 * the group's items via derivePriceRangeForGroup (T5). price_display_mode
 * is NOT consulted — the header range is the layout's inherent pricing
 * mode; the editor disables the price-display dropdown when this layout
 * is selected.
 */
import { derivePriceRangeForGroup } from '@/lib/kds/v3-render-helpers'
import type { ResolvedGroup, SlotFormatting } from '@/lib/kds/v3-render'
import {
  DENSITY_TO_ROW_PADDING,
  TITLE_SIZE_CLASS,
  BODY_SIZE_FOR_TITLE,
  TITLE_ALIGN_CLASS,
} from './style-mappings'

export interface CompactListRendererProps {
  group: ResolvedGroup
  formatting: SlotFormatting
}

export function CompactListRenderer({ group, formatting }: CompactListRendererProps) {
  const headerText = formatting.header_override ?? group.name
  const titleClass = `${TITLE_SIZE_CLASS[formatting.title_size]} ${TITLE_ALIGN_CLASS[formatting.title_align]}`
  const bodyClass = BODY_SIZE_FOR_TITLE[formatting.title_size]
  const rowPadding = DENSITY_TO_ROW_PADDING[formatting.density]

  const priceRange = derivePriceRangeForGroup(group.items)

  return (
    <div className="flex h-full w-full flex-col px-4 py-3 text-[color:var(--kds-text)]">
      <div className={`mb-2 font-bold ${titleClass}`}>
        {headerText}
        {priceRange && (
          <span className="ml-2 font-semibold text-[color:var(--kds-price)]">· {priceRange}</span>
        )}
      </div>
      <ul className={`flex-1 ${bodyClass}`}>
        {group.items.map((item) => (
          <li
            key={item.id}
            className={`flex items-baseline gap-2 ${rowPadding}`}
          >
            <span className="text-[color:var(--kds-text-muted)]">•</span>
            <span className="flex-1 truncate">{item.display_name}</span>
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
