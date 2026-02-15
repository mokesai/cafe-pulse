import { Toaster } from 'react-hot-toast'
import UnderConstruction from '@/components/maintenance/UnderConstruction'
import { getSiteStatusUsingServiceClient } from '@/lib/services/siteSettings'
import DynamicSquareProvider from '@/components/providers/DynamicSquareProvider'
import { CartModalProvider } from '@/providers/CartProvider'
import UserOnboarding from '@/components/onboarding/UserOnboarding'
import GlobalCartModal from '@/components/cart/GlobalCartModal'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'
import { getTenantIdentity } from '@/lib/tenant/identity'
import { TenantProvider } from '@/providers/TenantProvider'

export const dynamic = 'force-dynamic'

export default async function SiteLayout({
  children
}: {
  children: React.ReactNode
}) {
  const status = await getSiteStatusUsingServiceClient()

  if (!status.isCustomerAppLive) {
    return (
      <div className="min-h-screen bg-white">
        <UnderConstruction status={status} />
      </div>
    )
  }

  const tenantId = await getCurrentTenantId()
  const squareConfig = await getTenantSquareConfig(tenantId)
  const tenant = await getTenantIdentity()

  // Only pass public-safe fields to client
  const publicSquareConfig = squareConfig ? {
    applicationId: squareConfig.applicationId,
    locationId: squareConfig.locationId,
    environment: squareConfig.environment,
  } : null

  return (
    <TenantProvider tenant={tenant}>
      <DynamicSquareProvider config={publicSquareConfig}>
        <CartModalProvider>
          <div className="min-h-screen bg-white">
            {children}
            <UserOnboarding />
            <GlobalCartModal />
            <Toaster />
          </div>
        </CartModalProvider>
      </DynamicSquareProvider>
    </TenantProvider>
  )
}
