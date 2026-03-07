import { getTenantIdentity } from '@/lib/tenant/identity'
import { AdminLoginForm } from './AdminLoginForm'

export default async function AdminLoginPage() {
  const tenant = await getTenantIdentity()

  return (
    <AdminLoginForm
      tenantName={tenant.business_name || tenant.name}
    />
  )
}
