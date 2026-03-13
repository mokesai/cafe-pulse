import { createServiceClient } from '@/lib/supabase/server'

/**
 * Set a user as admin by email address
 * This should be run manually for the first admin user
 * @deprecated Use tenant_memberships table for role checks. See requireAdmin() in src/lib/auth/admin.ts.
 */
export async function setUserAsAdmin(email: string, tenantId: string) {
  const supabase = createServiceClient()

  // Find user by email in auth.users table and get their profile
  const { data: user, error: userError } = await supabase.auth.admin.listUsers()

  if (userError) {
    throw new Error(`Failed to fetch users: ${userError.message}`)
  }

  const targetUser = user.users.find(u => u.email === email)
  if (!targetUser) {
    throw new Error(`User with email ${email} not found`)
  }

  // Update the user's role in profiles table (tenant-scoped)
  const { data, error } = await supabase
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', targetUser.id)
    .eq('tenant_id', tenantId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update user role: ${error.message}`)
  }

  return data
}

/**
 * Check if a user is admin by user ID
 * @deprecated Use tenant_memberships table for role checks. See requireAdmin() in src/lib/auth/admin.ts.
 */
export async function isUserAdmin(userId: string, tenantId: string): Promise<boolean> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .single()

  if (error) {
    return false
  }

  return data.role === 'admin'
}

/**
 * Get user role by user ID
 * @deprecated Use tenant_memberships table for role checks. See requireAdmin() in src/lib/auth/admin.ts.
 */
export async function getUserRole(userId: string, tenantId: string): Promise<'customer' | 'admin' | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .single()

  if (error) {
    return null
  }

  return data.role as 'customer' | 'admin'
}
