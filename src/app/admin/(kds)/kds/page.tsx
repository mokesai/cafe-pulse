import Link from 'next/link'
import { Coffee, UtensilsCrossed, Monitor } from 'lucide-react'

export default function KDSHomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <div className="text-center mb-12">
        <h1 className="kds-header-logo mb-4" style={{ color: 'var(--kds-accent)' }}>
          Kitchen Display System
        </h1>
        <p className="kds-header-text" style={{ color: 'var(--kds-text-muted)' }}>
          Select a display to open
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl w-full">
        {/* Drinks Screen */}
        <Link
          href="/admin/kds/drinks"
          className="group flex flex-col items-center p-8 rounded-xl border-2 transition-all hover:scale-105"
          style={{
            borderColor: 'var(--kds-divider)',
            backgroundColor: 'var(--kds-bg-header)',
          }}
        >
          <div
            className="w-20 h-20 flex items-center justify-center rounded-full mb-4 group-hover:scale-110 transition-transform"
            style={{ backgroundColor: 'var(--kds-accent)' }}
          >
            <Coffee className="w-10 h-10 text-white" />
          </div>
          <h2 className="kds-category-title mb-2">Drinks</h2>
          <p style={{ color: 'var(--kds-text-muted)' }}>
            Hot drinks, espressos, cold drinks, blended
          </p>
          <div className="flex items-center gap-2 mt-4 text-sm" style={{ color: 'var(--kds-text-muted)' }}>
            <Monitor className="w-4 h-4" />
            <span>Screen 1</span>
          </div>
        </Link>

        {/* Food Screen */}
        <Link
          href="/admin/kds/food"
          className="group flex flex-col items-center p-8 rounded-xl border-2 transition-all hover:scale-105"
          style={{
            borderColor: 'var(--kds-divider)',
            backgroundColor: 'var(--kds-bg-header)',
          }}
        >
          <div
            className="w-20 h-20 flex items-center justify-center rounded-full mb-4 group-hover:scale-110 transition-transform"
            style={{ backgroundColor: 'var(--kds-accent)' }}
          >
            <UtensilsCrossed className="w-10 h-10 text-white" />
          </div>
          <h2 className="kds-category-title mb-2">Food</h2>
          <p style={{ color: 'var(--kds-text-muted)' }}>
            Breakfast, pastries, sandwiches, snacks
          </p>
          <div className="flex items-center gap-2 mt-4 text-sm" style={{ color: 'var(--kds-text-muted)' }}>
            <Monitor className="w-4 h-4" />
            <span>Screen 2</span>
          </div>
        </Link>
      </div>

      <div className="mt-12 text-center" style={{ color: 'var(--kds-text-muted)' }}>
        <p className="text-sm">
          Tip: Open each display in full-screen mode (F11) for best results
        </p>
      </div>
    </div>
  )
}
