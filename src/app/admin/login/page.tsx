import { headers } from 'next/headers'
import { getTenantIdentity } from '@/lib/tenant/identity'
import { extractSubdomain } from '@/lib/tenant/context'
import { AdminLoginForm } from './AdminLoginForm'

interface Props {
  searchParams: Promise<{ return?: string; message?: string; error?: string }>
}

export default async function AdminLoginPage({ searchParams }: Props) {
  const { return: returnTo, message, error } = await searchParams
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const slug = extractSubdomain(host)

  // Bare domain (no subdomain) → Café Pulse / platform login
  const isPlatform = !slug || returnTo?.startsWith('/platform')

  const initialMessage = message === 'password-updated'
    ? 'Password updated! Sign in with your new password.'
    : undefined

  if (isPlatform) {
    return (
      <AdminLoginForm
        tenantName="Café Pulse"
        isPlatform
        returnTo={returnTo || '/platform'}
        initialMessage={initialMessage}
        initialError={error}
      />
    )
  }

  const tenant = await getTenantIdentity()

  return (
    <AdminLoginForm
      tenantName={tenant.business_name || tenant.name}
      returnTo={returnTo}
      initialMessage={initialMessage}
      initialError={error}
    />
  )
}
