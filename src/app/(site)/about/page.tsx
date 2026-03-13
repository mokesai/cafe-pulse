'use client'

import Navigation from '@/components/Navigation'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import Image from 'next/image'
import { useTenant } from '@/providers/TenantProvider'

export default function About() {
  const tenant = useTenant()
  const tenantName = tenant.business_name || tenant.name
  return (
    <main className="min-h-screen">
      <Navigation />
      <Breadcrumbs />
      
      {/* Hero Section */}
      <section className="pt-16 py-20 bg-gradient-to-br from-primary-50 to-green-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
            About <span className="text-primary-600">{tenantName}</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            {tenantName} is a friendly cafe stand serving quality coffee, refreshing drinks, and quick bites.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Text Content */}
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">
                Crafted for Your Day
              </h2>
              <p className="text-gray-600 mb-6 text-lg">
                Every drink is made to order using quality ingredients, and our pastries and sandwiches are always fresh. Whether you&apos;re stopping by for a morning coffee, a midday treat, or a quick lunch, we&apos;re here to serve you with a smile.
              </p>
              <p className="text-gray-600 mb-8 text-lg">
                Stop by for a morning coffee, a midday treat, or a quick lunch — we&apos;re here to serve you with a smile.
              </p>
            </div>
            
            {/* Image Content */}
            <div className="flex items-center justify-center">
              {tenant.logo_url ? (
                <Image
                  src={tenant.logo_url}
                  alt={`${tenantName}`}
                  width={500}
                  height={400}
                  className="rounded-2xl object-cover shadow-lg w-full h-auto"
                  priority
                />
              ) : (
                <div className="bg-gradient-to-br from-primary-100 to-green-100 rounded-2xl w-full h-80 flex items-center justify-center shadow-lg">
                  <span className="text-8xl">☕</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Our Values */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Values</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              What drives us every day to serve our community with excellence.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center bg-white p-8 rounded-2xl shadow-sm">
              <div className="bg-primary-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">💫</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Quality First</h3>
              <p className="text-gray-600">We use only the finest ingredients and take pride in every drink and treat we serve.</p>
            </div>
            
            <div className="text-center bg-white p-8 rounded-2xl shadow-sm">
              <div className="bg-primary-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🤝</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Community</h3>
              <p className="text-gray-600">We&apos;re here to serve both visitors and staff, creating connections one cup at a time.</p>
            </div>
            
            <div className="text-center bg-white p-8 rounded-2xl shadow-sm">
              <div className="bg-primary-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">⚡</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Convenience</h3>
              <p className="text-gray-600">Quick, friendly service that fits perfectly into your busy day.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h3 className="text-2xl font-bold text-primary-400 mb-4">{tenantName}</h3>
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