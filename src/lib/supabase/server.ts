import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Create a Supabase client scoped to the current user session.
 * No tenant context -- use for auth operations and user-scoped queries
 * where tenant isolation is not required.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Create a service role client for admin operations.
 * Uses the secret key to bypass RLS -- no tenant context.
 * Use for system-level operations that need unrestricted access.
 */
export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      cookies: {
        getAll() {
          return []
        },
        setAll() {
          // Service role client doesn't need cookies
        },
      },
    }
  )
}

/**
 * Create a Supabase client scoped to a specific tenant.
 * Calls set_tenant_context RPC to set app.tenant_id session variable for RLS policies.
 */
export async function createTenantClient(tenantId: string) {
  const cookieStore = await cookies()

  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )

  // Set tenant context explicitly via RPC call
  const { error } = await client.rpc('set_tenant_context', { p_tenant_id: tenantId })
  if (error) {
    console.error('Failed to set tenant context:', error)
    // Continue anyway - queries will fail with RLS errors if tenant context not set
  }

  return client
}

/**
 * Create a Supabase client scoped to the current tenant (from cookie).
 * Use this in Server Components and API routes where tenant context
 * has already been set by middleware.
 */
export async function createCurrentTenantClient() {
  const { getCurrentTenantId } = await import('@/lib/tenant/context')
  const tenantId = await getCurrentTenantId()
  return createTenantClient(tenantId)
}
