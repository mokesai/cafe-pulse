import dynamic from 'next/dynamic'

// Dynamically import heavy inventory component
const InventoryManagement = dynamic(() => import('@/components/admin/InventoryManagement'), {
  loading: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading inventory management...</p>
      </div>
    </div>
  )
})

export default async function AdminInventoryPage() {

  return <InventoryManagement />
}