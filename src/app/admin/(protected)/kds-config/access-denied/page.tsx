import Link from 'next/link'
import { ShieldX } from 'lucide-react'

export default function KDSAccessDeniedPage() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center space-y-4">
        <ShieldX className="w-12 h-12 text-red-400 mx-auto" />
        <h1 className="text-xl font-bold text-white">Access Restricted</h1>
        <p className="text-gray-400 text-sm">You don&apos;t have permission to access KDS configuration.</p>
        <p className="text-gray-500 text-xs">Contact your café owner to request access.</p>
        <Link href="/admin/dashboard" className="inline-block mt-2 text-sm text-blue-400 hover:text-blue-300">
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
