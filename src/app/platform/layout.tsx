import { requirePlatformAdmin } from '@/lib/platform/auth'
import Link from 'next/link'
import { LogoutButton } from './LogoutButton'

const squareEnv = process.env.SQUARE_ENVIRONMENT || 'sandbox'
const isSandbox = squareEnv === 'sandbox'

export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { supabase, admin } = await requirePlatformAdmin()

  // Get current user email for display
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email || 'Unknown'
  const initials = email.split('@')[0].slice(0, 2).toUpperCase()

  const isSuperAdmin = admin.role === 'super_admin'

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cafe-pulse-logo.png" alt="Cafe Pulse" className="h-8 mb-2" />
          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${isSandbox ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isSandbox ? 'bg-yellow-500' : 'bg-green-500'}`} />
            {isSandbox ? 'Sandbox' : 'Production'}
          </div>
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
            {isSuperAdmin ? 'All Tenants' : 'My Tenants'}
          </Link>
          {isSuperAdmin && (
            <Link
              href="/platform/tenants/new"
              className="block px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              Onboard Tenant
            </Link>
          )}
        </nav>

        {/* User info and logout */}
        <div className="p-4 border-t border-gray-200 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{email}</p>
              <p className="text-xs text-gray-500 capitalize">{admin.role.replace('_', ' ')}</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Platform Management</h2>
            <div className={`text-sm font-medium ${isSandbox ? 'text-yellow-600' : 'text-green-600'}`}>
              {isSandbox ? 'Square Sandbox' : 'Square Production'}
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
