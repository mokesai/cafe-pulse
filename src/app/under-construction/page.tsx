import type { Metadata } from 'next'
import UnderConstruction from '@/components/maintenance/UnderConstruction'
import { getSiteStatusUsingServiceClient } from '@/lib/services/siteSettings'
import { getCurrentTenantId } from '@/lib/tenant/context'

export const metadata: Metadata = {
  title: 'Little Cafe – Under Construction',
  description: 'Our customer app is currently under construction. Please check back soon for updates.'
}

export default async function UnderConstructionPage() {
  const tenantId = await getCurrentTenantId()
  const status = await getSiteStatusUsingServiceClient(tenantId)

  return <UnderConstruction status={status} />
}
