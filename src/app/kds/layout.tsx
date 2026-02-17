import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { getSetting } from '@/lib/kds/queries'
import { getCurrentTenantId } from '@/lib/tenant/context'
import type { KDSTheme } from '@/lib/kds/types'
import KDSThemeWrapper from './components/KDSThemeWrapper'
import './kds-themes.css'

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

export default async function KDSLayout({
  children,
}: {
  children: React.ReactNode
}) {
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
