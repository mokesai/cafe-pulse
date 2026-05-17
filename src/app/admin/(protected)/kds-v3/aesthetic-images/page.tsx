'use client'

import dynamic from 'next/dynamic'

const AestheticImageLibrary = dynamic(
  () =>
    import('@/components/admin/kds-v3/AestheticImageLibrary').then(
      (mod) => mod.AestheticImageLibrary,
    ),
  {
    loading: () => <div className="text-sm text-gray-500">Loading library…</div>,
    ssr: false,
  },
)

export default function AestheticImagesPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <AestheticImageLibrary />
    </div>
  )
}
