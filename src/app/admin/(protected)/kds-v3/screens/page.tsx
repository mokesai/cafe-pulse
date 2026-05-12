/**
 * MOK-152 / KDS v3 phase 2 — screens list page (admin).
 *
 * Lives under (protected) so it inherits the admin sidebar / chrome. The
 * list is rendered client-side via ScreensList because it has refresh +
 * delete actions; server fetch on initial mount keeps the first paint fast.
 */
import { ScreensList } from '@/components/admin/kds-v3/ScreensList'

export const dynamic = 'force-dynamic'

export default function KdsV3ScreensPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">KDS Screens (v3)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Configure up to 2 KDS screens for this location. Each screen has its own grid
          layout. Box content (menu groups, aesthetic images) is wired up in later phases.
        </p>
      </div>
      <ScreensList />
    </div>
  )
}
