import { CogsStatusChip } from './dashboard/CogsStatusChip'

/**
 * B2 / MOK-174 — thin top bar across every admin page (fills the layout's reserved 64px top
 * strip), carrying the persistent COGS status chip so COGS health is visible app-wide.
 */
export function AdminTopBar() {
  return (
    <header className="fixed top-0 left-64 right-0 z-40 h-16 bg-white border-b border-gray-200 flex items-center justify-end gap-4 px-8">
      <CogsStatusChip />
    </header>
  )
}
