import dynamic from 'next/dynamic'

// Dynamically import heavy menu management component
const MenuManagementContainer = dynamic(() => import('@/components/admin/MenuManagementContainer'), {
  loading: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading menu management...</p>
      </div>
    </div>
  ),
})

export default async function AdminMenuPage() {

  return <MenuManagementContainer />
}