'use client'

import dynamic from 'next/dynamic'

const ScreenForm = dynamic(
  () => import('@/components/admin/kds-v3/ScreenForm').then((mod) => mod.ScreenForm),
  {
    loading: () => <div className="text-sm text-gray-500">Loading editor…</div>,
    ssr: false,
  },
)

export default function NewScreenPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <ScreenForm />
    </div>
  )
}
