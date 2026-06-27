import type { Metadata, Viewport } from 'next'
import './kds-themes.css'

/**
 * Top-level layout for /kds/* public routes. v3 owns its own theme class
 * application (set in KDSv3GridCanvas per the kds_screens.theme column);
 * this layout's only responsibility is to import kds-themes.css so the
 * CSS variables (--kds-text, --kds-price, etc.) are available downstream.
 *
 * Phase 7 (MOK-160) removed the v2 KDSThemeWrapper + v2 settings lookup
 * that used to live here — both were v2-only.
 */
export const metadata: Metadata = {
  title: 'KDS — Cafe Pulse',
  description: 'Kitchen Display System',
  robots: 'noindex, nofollow',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function KDSLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
