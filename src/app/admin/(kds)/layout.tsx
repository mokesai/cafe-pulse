import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { requireAdmin } from '@/lib/admin/auth'
import { getSetting } from '@/lib/kds/queries'
import { getCurrentTenantId } from '@/lib/tenant/context'
import type { KDSTheme } from '@/lib/kds/types'
import KDSThemeWrapper from '@/app/kds/components/KDSThemeWrapper'
import '@/app/kds/kds-themes.css'

export const metadata: Metadata = {
  title: 'Little Cafe - Menu Display',
  description: 'Kitchen Display System for Little Cafe',
  robots: 'noindex, nofollow', // Don't index KDS pages
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

/**
 * KDS Layout - admin-protected full-screen display without sidebar
 * This route group has its own layout to avoid the admin navigation
 */
export default async function KDSLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Protect KDS routes - only admin users can access
  await requireAdmin()

  const tenantId = await getCurrentTenantId()
  const dbTheme = (await getSetting(tenantId, 'theme')) as KDSTheme | null

  return (
    <Suspense fallback={<div className="kds-root theme-warm">{children}</div>}>
      <KDSThemeWrapper dbTheme={dbTheme ?? 'warm'}>
        {children}
      </KDSThemeWrapper>
    </Suspense>
  )
}
