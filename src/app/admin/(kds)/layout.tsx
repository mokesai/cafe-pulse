import type { Metadata, Viewport } from 'next'
import { requireAdmin } from '@/lib/admin/auth'
// Import warm theme (switch to '@/app/kds/kds.css' for dark theme)
import '@/app/kds/kds-warm.css'

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

  return (
    <div
      className="kds-root"
      style={{ backgroundColor: '#d4b896' }}
    >
      {children}
    </div>
  )
}
