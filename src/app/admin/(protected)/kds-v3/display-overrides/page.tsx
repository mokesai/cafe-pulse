'use client'

import dynamic from 'next/dynamic'

const DisplayOverridesPage = dynamic(
  () =>
    import('@/components/admin/kds-v3/DisplayOverridesPage').then(
      (mod) => mod.DisplayOverridesPage,
    ),
  {
    loading: () => <div className="text-sm text-gray-500">Loading overrides…</div>,
    ssr: false,
  },
)

export default function Page() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <DisplayOverridesPage />
    </div>
  )
}
