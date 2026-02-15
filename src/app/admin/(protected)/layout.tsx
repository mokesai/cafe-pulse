import { requireAdmin } from '@/lib/admin/auth'
import { AdminNavigation } from '@/components/admin/AdminNavigation'
import { getTenantIdentity } from '@/lib/tenant/identity'
import { TenantProvider } from '@/providers/TenantProvider'

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // This will redirect to /admin/login if not authenticated or not admin of this tenant
  // tenantClient has tenant context set via set_tenant_context RPC
  // All queries using this client benefit from RLS tenant isolation
  const { user, membership, tenantClient, tenantId } = await requireAdmin()
  const tenant = await getTenantIdentity()

  return (
    <TenantProvider tenant={tenant}>
      <div className="min-h-screen bg-gray-50">
        {/* Admin Navigation */}
        <AdminNavigation />

        {/* Main Content */}
        <main className="pl-64 pt-16">
          <div className="p-8">
            {children}
          </div>
        </main>
      </div>
    </TenantProvider>
  )
}