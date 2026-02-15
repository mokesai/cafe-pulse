import { AdminDashboardOverview } from '@/components/admin/AdminDashboardOverview'

export default async function AdminDashboardPage() {

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-2">
          Welcome back! Here&rsquo;s what&rsquo;s happening at Little Cafe today.
        </p>
      </div>

      <AdminDashboardOverview />
    </div>
  )
}
