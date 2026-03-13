import { AdminDashboardOverview } from '@/components/admin/AdminDashboardOverview'
import { getTenantIdentity } from '@/lib/tenant/identity'

export default async function AdminDashboardPage() {
  const tenant = await getTenantIdentity()

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-2">
          Welcome back! Here&rsquo;s what&rsquo;s happening at {tenant.business_name || tenant.name} today.
        </p>
      </div>

      <AdminDashboardOverview />
    </div>
  )
}
