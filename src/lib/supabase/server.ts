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
 * Passes x-tenant-id header which the PostgreSQL pre-request function
 * reads to set app.tenant_id session variable for RLS policies.
 */
export async function createTenantClient(tenantId: string) {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        headers: {
          'x-tenant-id': tenantId,
        },
      },
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
 * Create a Supabase client scoped to the current tenant (from cookie).
 * Use this in Server Components and API routes where tenant context
 * has already been set by middleware.
 */
export async function createCurrentTenantClient() {
  const cookieStore = await cookies()
  const tenantId = cookieStore.get('x-tenant-id')?.value
  if (!tenantId) {
    // Fall back to default tenant
    const { DEFAULT_TENANT_ID } = await import('@/lib/tenant/types')
    return createTenantClient(DEFAULT_TENANT_ID)
  }
  return createTenantClient(tenantId)
}
