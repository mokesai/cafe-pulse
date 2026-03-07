'use client'

import Navigation from '@/components/Navigation'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import Link from 'next/link'
import { useTenant } from '@/providers/TenantProvider'

export default function Auth() {
  const tenant = useTenant()
  const tenantName = tenant.business_name || tenant.name
  return (
    <main className="min-h-screen">
      <Navigation />
      <Breadcrumbs />
      
      {/* Hero Section */}
      <section className="pt-16 py-20 bg-gradient-to-br from-amber-50 to-orange-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
            Welcome <span className="text-amber-600">Back</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Sign in to your account to track orders, save favorites, and enjoy a personalized experience.
          </p>
        </div>
      </section>

      {/* Auth Content */}
      <section className="py-20 bg-white">
        <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8">
          {/* This will be enhanced in Phase 2 with proper auth components */}
          <div className="text-center py-20">
            <div className="text-6xl mb-6">🔐</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Authentication Coming Soon!</h2>
            <p className="text-gray-600 mb-8">
              We&apos;re building a better login experience. The current authentication system is integrated into the navigation menu.
            </p>
            <Link
              href="/"
              className="bg-amber-600 text-white px-8 py-3 rounded-lg text-lg font-semibold hover:bg-amber-700 transition-colors duration-200 inline-block"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h3 className="text-2xl font-bold text-amber-400 mb-4">{tenantName}</h3>
          <p className="text-gray-400 mb-6">
            Where every cup tells a story. Thank you for being part of our community.
          </p>
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