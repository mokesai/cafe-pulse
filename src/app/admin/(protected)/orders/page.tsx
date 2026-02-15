export default async function AdminOrdersPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Order Management</h1>
        <p className="text-gray-600 mt-2">
          View and manage all customer orders in real-time.
        </p>
      </div>

      <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-semibold text-blue-900 mb-2">Orders Component Under Maintenance</h3>
        <p className="text-blue-700 text-sm">
          The OrdersManagement component is experiencing loading issues and has been temporarily disabled.
          The API routes have been fixed and are working correctly with tenant-aware filtering.
        </p>
        <p className="text-blue-600 text-xs mt-2">
          You can access order data via the API at /api/admin/orders
        </p>
      </div>
    </div>
  )
}