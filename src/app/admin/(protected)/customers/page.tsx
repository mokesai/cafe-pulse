'use client'

import dynamic from 'next/dynamic'

const CustomersManagement = dynamic(
  () => import('@/components/admin/CustomersManagement').then(mod => mod.CustomersManagement),
  {
    loading: () => <div>Loading customers...</div>,
    ssr: false
  }
)

export default function AdminCustomersPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Customer Management</h1>
        <p className="text-gray-600 mt-2">
          View and manage customer accounts, order history, and preferences.
        </p>
      </div>

      <CustomersManagement />
    </div>
  )
}