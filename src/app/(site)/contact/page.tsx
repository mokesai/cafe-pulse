'use client'

import Navigation from '@/components/Navigation'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { MapPin, Clock, Phone, Mail } from 'lucide-react'
import { useTenant } from '@/providers/TenantProvider'

export default function Contact() {
  const tenant = useTenant()
  const tenantName = tenant.business_name || tenant.name
  const hours = tenant.business_hours as Record<string, string> | null

  const formatHours = (hours: Record<string, string>) => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    return days
      .filter(day => hours[day] && hours[day] !== 'Closed')
      .map(day => ({
        day: day.charAt(0).toUpperCase() + day.slice(1),
        time: hours[day]
      }))
  }

  return (
    <main className="min-h-screen">
      <Navigation />
      <Breadcrumbs />

      {/* Hero Section */}
      <section className="pt-16 py-20 bg-gradient-to-br from-primary-50 to-green-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
            Visit <span className="text-primary-600">{tenantName}</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            We&apos;d love to see you! Stop by for a coffee, pastry, or a quick bite.
          </p>
        </div>
      </section>

      {/* Contact Information */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12">
            {/* Contact Details */}
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-8">Get in Touch</h2>

              <div className="space-y-6">
                {tenant.business_address && (
                  <div className="flex items-start space-x-4">
                    <MapPin className="h-6 w-6 text-primary-600 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Address</h3>
                      <p className="text-gray-600">{tenant.business_address}</p>
                    </div>
                  </div>
                )}

                {hours && (
                  <div className="flex items-start space-x-4">
                    <Clock className="h-6 w-6 text-primary-600 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Hours</h3>
                      <div className="text-gray-600 space-y-1">
                        {formatHours(hours).map(({ day, time }) => (
                          <p key={day}>{day}: {time}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {tenant.business_phone && (
                  <div className="flex items-start space-x-4">
                    <Phone className="h-6 w-6 text-primary-600 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Phone</h3>
                      <p className="text-gray-600">
                        <a href={`tel:${tenant.business_phone}`} className="hover:text-primary-600 transition-colors">
                          {tenant.business_phone}
                        </a>
                      </p>
                    </div>
                  </div>
                )}

                {tenant.business_email && (
                  <div className="flex items-start space-x-4">
                    <Mail className="h-6 w-6 text-primary-600 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Email</h3>
                      <p className="text-gray-600">
                        <a href={`mailto:${tenant.business_email}`} className="hover:text-primary-600 transition-colors">
                          {tenant.business_email}
                        </a>
                      </p>
                    </div>
                  </div>
                )}

                {!tenant.business_address && !tenant.business_phone && !tenant.business_email && !hours && (
                  <div className="p-6 bg-gray-50 rounded-2xl">
                    <p className="text-gray-600">Contact information coming soon.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Map or Placeholder */}
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-8">Location</h2>
              {tenant.business_address ? (
                <div className="bg-gradient-to-br from-primary-100 to-green-200 rounded-2xl p-4 h-96">
                  <iframe
                    title="Cafe Location Map"
                    src={`https://www.google.com/maps?q=${encodeURIComponent(tenant.business_address)}&output=embed`}
                    width="100%"
                    height="100%"
                    style={{ border: 0, borderRadius: '1rem', width: '100%', height: '100%' }}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  ></iframe>
                </div>
              ) : (
                <div className="bg-gradient-to-br from-primary-100 to-green-200 rounded-2xl h-96 flex items-center justify-center">
                  <div className="text-center">
                    <MapPin className="h-16 w-16 text-primary-400 mx-auto mb-4" />
                    <p className="text-primary-700 font-medium">Location details coming soon</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Ready for Your Next Coffee?</h2>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            We&apos;re excited to serve you our freshly made drinks and treats.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/menu"
              className="bg-primary-600 text-white px-8 py-3 rounded-lg text-lg font-semibold hover:bg-primary-700 transition-colors duration-200 inline-block"
            >
              Browse Our Menu
            </a>
            {tenant.business_phone && (
              <a
                href={`tel:${tenant.business_phone}`}
                className="border-2 border-primary-600 text-primary-600 px-8 py-3 rounded-lg text-lg font-semibold hover:bg-primary-600 hover:text-white transition-colors duration-200 inline-block"
              >
                Call Ahead
              </a>
            )}
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
