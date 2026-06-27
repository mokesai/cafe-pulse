/**
 * KDS v3 phase 6 — admin preview route.
 *
 * Renders the same composition the Pi-facing /kds/v3/[deviceId]/[screenId]
 * route renders, but inside the admin layout, with no device-token auth —
 * the (protected) layout's requireAdmin gate is the only auth boundary.
 *
 * Lets the operator iterate on a screen's layout / overrides / aesthetics
 * without needing a paired Pi. Reads the current saved state of the screen,
 * which today is also what the Pi sees. The proper draft → published
 * workflow is parked for phase 6.5.
 *
 * Reuses resolveScreenForRender (T4) — same data path as the Pi route, just
 * a different auth context. Tenant scope comes from the admin's session
 * via getCurrentTenantId.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { resolveScreenForRender } from '@/lib/kds/v3-render'
import { KDSv3PreviewCanvas } from '@/components/kds/v3/KDSv3PreviewCanvas'
import '@/app/kds/kds-themes.css'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function KDSv3ScreenPreviewPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()
  // Admin preview always shows the draft so the operator can iterate
  // without publishing. Pi devices see the published snapshot instead.
  const resolved = await resolveScreenForRender(supabase, tenantId, id, { source: 'draft' })
  if (!resolved) notFound()

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-4">
        <Link
          href="/admin/kds-v3/screens"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to screens
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Preview · {resolved.screen.name}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Grid {resolved.screen.grid_rows}×{resolved.screen.grid_cols} · theme{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">
                {resolved.screen.theme}
              </code>{' '}
              · {resolved.boxes.length} {resolved.boxes.length === 1 ? 'box' : 'boxes'}
            </p>
          </div>
          <Link
            href={`/admin/kds-v3/screens/${resolved.screen.id}/edit`}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Edit screen
          </Link>
        </div>
      </div>

      <KDSv3PreviewCanvas resolved={resolved} />

      <p className="mt-3 text-xs text-gray-500">
        This is a live render of the screen&apos;s saved state. Edit the screen, then click
        ⟳ Refresh above to see your changes. (The draft → published workflow ships in a
        later phase; today every save is visible to the Pi as well.)
      </p>
    </div>
  )
}
