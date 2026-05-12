'use client'

/**
 * MOK-152 / KDS v3 phase 2 — screens list page (admin).
 *
 * Matches the loading pattern used by other admin client pages (e.g.
 * customers/page.tsx): 'use client' + next/dynamic with ssr:false. This
 * avoids Server→Client boundary hiccups in dev mode and is the convention
 * other pages use.
 */
import dynamic from 'next/dynamic'

const ScreensList = dynamic(
  () => import('@/components/admin/kds-v3/ScreensList').then((mod) => mod.ScreensList),
  {
    loading: () => <div className="text-sm text-gray-500">Loading screens…</div>,
    ssr: false,
  },
)

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
