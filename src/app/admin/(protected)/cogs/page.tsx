import dynamic from 'next/dynamic'

const COGSManagement = dynamic(() => import('@/components/admin/COGSManagement'), {
  loading: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading COGS reporting...</p>
      </div>
    </div>
  )
})

export default async function AdminCOGSPage() {
  // Auth check handled by layout
  return <COGSManagement />
}

