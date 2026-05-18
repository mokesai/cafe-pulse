'use client'

/**
 * MOK-158 / KDS v3 phase 6 — reusable 1920×1080 grid canvas.
 *
 * Used by:
 *   - /kds/v3/[deviceId]/[screenId] (Pi-facing) — wrapped in KDSDisplayWrapper
 *     (viewport-scaling) + 30s polling.
 *   - /admin/kds-v3/screens/[id]/preview — wrapped in KDSv3PreviewCanvas
 *     (parent-width-scaling) + manual refresh button.
 *
 * Renders the grid + per-box slot routing. Stateless aside from React lifecycle.
 * Theme class application happens here so both wrappers inherit it.
 */
import { SimpleListRenderer } from './SimpleListRenderer'
import { VariationColumnHeaderRenderer } from './VariationColumnHeaderRenderer'
import { FlavorListRenderer } from './FlavorListRenderer'
import { CompactListRenderer } from './CompactListRenderer'
import type { ResolvedScreen, ResolvedSlotContent } from '@/lib/kds/v3-render'

export const CANVAS_W = 1920
export const CANVAS_H = 1080

export function KDSv3GridCanvas({ resolved }: { resolved: ResolvedScreen }) {
  const { screen, boxes } = resolved
  const themeClass = `theme-${screen.theme}`

  return (
    <div
      className={`${themeClass} relative bg-[color:var(--kds-bg)] font-[family-name:var(--kds-font-body)]`}
      style={{ width: CANVAS_W, height: CANVAS_H }}
    >
      <div
        className="grid h-full w-full gap-2 p-3"
        style={{
          gridTemplateRows: `repeat(${screen.grid_rows}, minmax(0, 1fr))`,
          gridTemplateColumns: `repeat(${screen.grid_cols}, minmax(0, 1fr))`,
        }}
      >
        {boxes.map((box) => {
          const isHorizontal = box.division === 'horizontal'
          const isVertical = box.division === 'vertical'
          const divided = isHorizontal || isVertical
          return (
            <div
              key={box.id}
              className={`overflow-hidden rounded-md bg-[color:var(--kds-bg-category)] shadow-[var(--kds-shadow-sm)] ${
                divided ? (isHorizontal ? 'flex flex-col' : 'flex flex-row') : ''
              }`}
              style={{
                gridRow: `${box.row_start} / span ${box.row_span}`,
                gridColumn: `${box.col_start} / span ${box.col_span}`,
              }}
            >
              {divided && box.slotB ? (
                <>
                  <div className="flex-1 overflow-hidden">{renderSlot(box.slotA)}</div>
                  <div
                    className={`bg-[color:var(--kds-divider-strong)] ${isHorizontal ? 'h-px w-full' : 'h-full w-px'}`}
                    aria-hidden="true"
                  />
                  <div className="flex-1 overflow-hidden">{renderSlot(box.slotB)}</div>
                </>
              ) : (
                renderSlot(box.slotA)
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function renderSlot(slot: ResolvedSlotContent) {
  if (slot.kind === 'unbound') {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm italic text-[color:var(--kds-text-muted)]">
        (unbound)
      </div>
    )
  }
  if (slot.kind === 'image_only') {
    return (
      <div className="relative h-full w-full overflow-hidden">
        {slot.image?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.image.url}
            alt={slot.image.alt_text ?? slot.image.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm italic text-[color:var(--kds-text-muted)]">
            (no image)
          </div>
        )}
        {slot.header_override && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-3 py-2 text-center font-semibold text-white">
            {slot.header_override}
          </div>
        )}
      </div>
    )
  }

  // menu_group slot — route by layout_mode.
  const { group, formatting } = slot
  switch (formatting.layout_mode) {
    case 'simple_list':
      return <SimpleListRenderer group={group} formatting={formatting} />
    case 'variation_column_header':
      return <VariationColumnHeaderRenderer group={group} formatting={formatting} />
    case 'flavor_list':
      return <FlavorListRenderer group={group} formatting={formatting} />
    case 'compact_list':
      return <CompactListRenderer group={group} formatting={formatting} />
    default:
      return (
        <div className="flex h-full w-full items-center justify-center text-sm italic text-[color:var(--kds-text-muted)]">
          (unknown layout)
        </div>
      )
  }
}
