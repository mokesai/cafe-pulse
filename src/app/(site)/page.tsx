'use client'

import Navigation from '@/components/Navigation'
import SmoothScrollNav from '@/components/navigation/SmoothScrollNav'
import Image from 'next/image'
import Link from 'next/link'
import { useTenant } from '@/providers/TenantProvider'

const scrollSections = [
  { id: 'hero', label: 'Home', href: '#hero' },
  { id: 'highlights', label: 'Highlights', href: '#highlights' },
  { id: 'contact', label: 'Contact', href: '#contact' }
]

export default function Home() {
  const tenant = useTenant()
  const tenantName = tenant.business_name || tenant.name
  const subtitle = (tenant.features as Record<string, unknown>)?.subtitle as string | undefined
  return (
    <main className="min-h-screen">
      <Navigation />
      <SmoothScrollNav sections={scrollSections} />
      
      {/* Hero Section */}
      <section id="hero" className="pt-16 min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-green-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="mb-8">
            {tenant.logo_url ? (
              <div className="flex justify-center mb-6">
                <Image
                  src={tenant.logo_url}
                  alt={`${tenantName} Logo`}
                  width={240}
                  height={240}
                  className="object-contain"
                  priority
                />
              </div>
            ) : (
              <div className="flex justify-center mb-6">
                <div className="bg-primary-100 rounded-full w-40 h-40 flex items-center justify-center">
                  <span className="text-6xl">☕</span>
                </div>
              </div>
            )}
            <h1 className="text-5xl md:text-7xl font-bold text-gray-900 mb-4">
              Welcome to{' '}
              <span className="text-primary-600">{tenantName}</span>
            </h1>
            {subtitle && (
              <p className="text-lg text-gray-500 font-medium mb-6">
                {subtitle}
              </p>
            )}
            <p className="text-xl md:text-2xl text-gray-600 mb-8 max-w-3xl mx-auto">
              Where every cup tells a story. Experience the perfect blend of comfort, 
              community, and exceptional coffee in our warm and inviting space.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/menu"
                className="bg-primary-600 text-white px-8 py-3 rounded-lg text-lg font-semibold hover:bg-primary-700 transition-colors duration-200 inline-block text-center"
              >
                View Our Menu
              </Link>
              <Link
                href="/contact"
                className="border-2 border-primary-600 text-primary-600 px-8 py-3 rounded-lg text-lg font-semibold hover:bg-primary-600 hover:text-white transition-colors duration-200 inline-block text-center"
              >
                Visit Us Today
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Highlights */}
      <section id="highlights" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Why Choose {tenantName}?</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Your friendly neighborhood cafe serving quality drinks and fresh treats.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-primary-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">☕</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Quality Coffee</h3>
              <p className="text-gray-600">Every drink is made to order using quality ingredients.</p>
            </div>
            
            <div className="text-center">
              <div className="bg-primary-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🥐</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Fresh Pastries</h3>
              <p className="text-gray-600">Our pastries and sandwiches are always fresh and delicious.</p>
            </div>
            
            <div className="text-center">
              <div className="bg-primary-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">📍</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Convenient Location</h3>
              <p className="text-gray-600">{tenant.business_address || 'Conveniently located to serve you.'}</p>
            </div>
          </div>
          
          <div className="text-center mt-12">
            <Link
              href="/about"
              className="text-primary-600 font-semibold hover:text-primary-700 transition-colors"
            >
              Learn more about our story →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="bg-gray-900 text-white py-12">
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