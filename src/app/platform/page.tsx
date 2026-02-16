export default function PlatformDashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Platform Dashboard</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600">
          Welcome to the Platform Control Plane. This is where you'll manage all tenants across the cafe platform.
        </p>
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> To create your first platform admin and test this interface, run the bootstrap script in the next phase.
          </p>
        </div>
      </div>
    </div>
  )
}
