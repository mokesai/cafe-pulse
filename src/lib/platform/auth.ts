import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Server-side platform admin authentication check
 *
 * Verifies that the current user is a platform administrator by checking the
 * platform_admins table. Platform admins have elevated privileges to manage
 * all tenants across the platform.
 *
 * @returns Authenticated Supabase client for platform operations
 * @throws Redirects to /admin/login if not authenticated
 * @throws Redirects to /unauthorized if not a platform admin
 */
export async function requirePlatformAdmin() {
  const supabase = await createClient()

  // 1. Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/admin/login?return=/platform')
  }

  // 2. Check platform_admins table
  const { data: platformAdmin, error: platformError } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (platformError || !platformAdmin) {
    // User authenticated but not a platform admin
    redirect('/unauthorized?reason=not-platform-admin')
  }

  // Return authenticated client for platform operations
  return supabase
}

/**
 * Helper function to check if a user is a platform administrator
 *
 * Used by middleware for quick boolean checks without throwing redirects.
 *
 * @param userId - The user ID to check
 * @returns true if user is a platform admin, false otherwise
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient()

  const { data: platformAdmin } = await supabase
    .from('platform_admins')
    .select('id')
    .eq('user_id', userId)
    .single()

  return !!platformAdmin
}
