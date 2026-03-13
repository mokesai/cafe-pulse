'use client'

import Navigation from '@/components/Navigation'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import DynamicMenu from '@/components/DynamicMenu'
import { useTenant } from '@/providers/TenantProvider'

export default function Menu() {
  const tenant = useTenant()
  const tenantName = tenant.business_name || tenant.name
  const subtitle = (tenant.features as Record<string, unknown>)?.subtitle as string | undefined
  return (
    <main className="min-h-screen">
      <Navigation />
      <Breadcrumbs />
      
      {/* Hero Section - Compact */}
      <section className="pt-16 py-12 bg-gradient-to-br from-primary-50 to-green-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Our <span className="text-primary-600">Menu</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Fresh coffee, pastries, and treats made with quality ingredients. Real-time pricing from our Square system.
          </p>
        </div>
      </section>

      {/* Menu Section */}
      <DynamicMenu />

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-primary-400 mb-1">{tenantName}</h3>
            {subtitle && <p className="text-sm text-gray-500 mb-4">{subtitle}</p>}
            <p className="text-gray-400">
              Where every cup tells a story. Thank you for being part of our community.
            </p>
          </div>
          <div className="border-t border-gray-800 pt-6">
            <p className="text-gray-400 text-sm">
              © {new Date().getFullYear()} {tenantName}. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}