import Link from 'next/link'
import AuthHashRedirect from './AuthHashRedirect'

export default function PlatformLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center px-4">
      <AuthHashRedirect />
      <div className="max-w-lg w-full text-center">
        {/* Logo */}
        <div className="mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/cafe-pulse-logo.png"
            alt="Cafe Pulse"
            className="h-20 mx-auto mb-6"
          />
          <p className="text-gray-600 text-lg">
            Multi-tenant cafe management platform
          </p>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <Link
            href="/platform"
            className="block w-full bg-amber-600 hover:bg-amber-700 text-white py-3 px-6 rounded-lg font-medium transition-colors mb-4"
          >
            Platform Admin Login
          </Link>
          <p className="text-sm text-gray-500">
            Manage tenants, onboarding, and platform settings
          </p>
        </div>

        {/* Tenant access info */}
        <div className="text-sm text-gray-500 space-y-2">
          <p>
            Tenant sites are accessed via subdomain:
          </p>
          <p className="font-mono text-gray-600 bg-white/60 rounded-md py-2 px-3 inline-block">
            https://&lt;tenant-slug&gt;.yourdomain.com
          </p>
        </div>
      </div>
    </div>
  )
}
