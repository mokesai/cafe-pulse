'use client'

/**
 * KDS v3 admin shell — shared tab strip across the three sub-areas
 * (Screens / Images / Overrides). Sidebar collapses to a single "KDS v3
 * (beta)" entry that lands here; this layout handles in-page tab nav.
 *
 * Each tab is a real route (bookmarkable, refreshable). The screens edit
 * page nests deeper under /screens/[id]/edit — the Screens tab stays
 * highlighted on any /screens/* path.
 *
 * Will rename to "KDS Setup" after the phase 7 v2 cutover (MOK-159).
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Tab {
  name: string
  href: string
  match: (path: string) => boolean
}

const TABS: Tab[] = [
  {
    name: 'Screens',
    href: '/admin/kds-v3/screens',
    match: (p) => p.startsWith('/admin/kds-v3/screens'),
  },
  {
    name: 'Images',
    href: '/admin/kds-v3/aesthetic-images',
    match: (p) => p.startsWith('/admin/kds-v3/aesthetic-images'),
  },
  {
    name: 'Overrides',
    href: '/admin/kds-v3/display-overrides',
    match: (p) => p.startsWith('/admin/kds-v3/display-overrides'),
  },
  {
    name: 'Devices',
    href: '/admin/kds-v3/devices',
    match: (p) => p.startsWith('/admin/kds-v3/devices'),
  },
]

export default function KdsV3Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''

  return (
    <div>
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex gap-1" aria-label="KDS v3 sections">
            {TABS.map((tab) => {
              const active = tab.match(pathname)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                    active
                      ? 'text-blue-700'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab.name}
                  {active && (
                    <span
                      className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}
