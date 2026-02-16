import { requirePlatformAdmin } from '@/lib/platform/auth'
import Link from 'next/link'
import { LogoutButton } from './LogoutButton'

export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // This will redirect to /login if not authenticated or not platform admin
  // Middleware already checked MFA, this is a server-side double-check
  await requirePlatformAdmin()

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">Platform Admin</h1>
          <p className="text-sm text-gray-500 mt-1">Cafe Platform Control Plane</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <Link
            href="/platform"
            className="block px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/platform/tenants"
            className="block px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            All Tenants
          </Link>
          <Link
            href="/platform/tenants/new"
            className="block px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            Onboard Tenant
          </Link>
        </nav>

        <div className="p-4 border-t border-gray-200">
          <LogoutButton />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Platform Management</h2>
            <div className="text-sm text-gray-500">
              Super Admin Access
            </div>
          </div>
        </header>

        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
