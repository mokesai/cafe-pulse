/**
 * MOK-158 / KDS v3 phase 6 — `simple_list` layout renderer.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T6)
 *
 * Group title at top + each item on its own line with derived price text.
 * Per-item price text comes from derivePriceText(price_display_mode, vs).
 * Density / title_size / title_align come from the slot's formatting block.
 *
 * Items are pre-filtered for hidden_from_kds=true server-side (T4).
 */
import { derivePriceText } from '@/lib/kds/v3-render-helpers'
import type { ResolvedGroup, SlotFormatting } from '@/lib/kds/v3-render'
import {
  DENSITY_TO_ROW_PADDING,
  TITLE_SIZE_CLASS,
  BODY_SIZE_FOR_TITLE,
  TITLE_ALIGN_CLASS,
} from './style-mappings'

export interface SimpleListRendererProps {
  group: ResolvedGroup
  formatting: SlotFormatting
}

export function SimpleListRenderer({ group, formatting }: SimpleListRendererProps) {
  const headerText = formatting.header_override ?? group.name
  const titleClass = `${TITLE_SIZE_CLASS[formatting.title_size]} ${TITLE_ALIGN_CLASS[formatting.title_align]}`
  const bodyClass = BODY_SIZE_FOR_TITLE[formatting.title_size]
  const rowPadding = DENSITY_TO_ROW_PADDING[formatting.density]

  return (
    <div className="flex h-full w-full flex-col px-4 py-3 text-[color:var(--kds-text)]">
      <h2 className={`font-bold ${titleClass} mb-2`}>{headerText}</h2>
      <ul className={`flex-1 ${bodyClass}`}>
        {group.items.map((item) => {
          const price = derivePriceText(formatting.price_display_mode, item.variations)
          return (
            <li
              key={item.id}
              className={`flex items-baseline justify-between gap-3 ${rowPadding} border-b border-[color:var(--kds-divider)] last:border-b-0`}
            >
              <span className="truncate">{item.display_name}</span>
              {price && (
                <span className="font-semibold text-[color:var(--kds-price)]">{price}</span>
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
