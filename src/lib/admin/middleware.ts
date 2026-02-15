import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { rateLimiters } from '@/lib/security/rate-limiter'
import { addSecurityHeaders } from '@/lib/security/headers'

export interface AdminAuthSuccess {
  user: User
  membership: { role: string }
  userId: string
  tenantId: string
  sessionInfo: {
    age: number
    ip: string
  }
}

export type AdminAuthResult = Response | AdminAuthSuccess

/**
 * Admin authentication middleware for API routes with enhanced security
 * Returns admin auth info or NextResponse error
 */
export async function requireAdminAuth(request: NextRequest): Promise<AdminAuthResult> {
  try {
    // Apply admin-specific rate limiting
    const rateLimitResult = rateLimiters.admin(request)
    if (!rateLimitResult.success) {
      const response = NextResponse.json(
        { error: rateLimitResult.error },
        { status: 429 }
      )
      Object.entries(rateLimitResult.headers || {}).forEach(([key, value]) => {
        response.headers.set(key, value)
      })
      return addSecurityHeaders(response)
    }

    // CSRF protection check
    const referer = request.headers.get('referer')
    const origin = request.headers.get('origin')
    const host = request.headers.get('host')
    const envOrigin = process.env.NEXT_PUBLIC_APP_URL

    // Allow requests from same origin or valid referer
    const allowedOrigins = [
      `https://${host}`,
      `http://${host}`,
      'http://localhost:3000',
      'http://localhost:3001'
    ]
    if (envOrigin) {
      allowedOrigins.push(envOrigin)
      const httpVariant = envOrigin.replace(/^https:\/\//, 'http://')
      const httpsVariant = envOrigin.replace(/^http:\/\//, 'https://')
      allowedOrigins.push(httpVariant, httpsVariant)
    }
    
    const hasValidOrigin = origin && allowedOrigins.includes(origin)
    const hasValidReferer = referer && allowedOrigins.some(allowed => referer.startsWith(allowed))
    
    if (!hasValidOrigin && !hasValidReferer) {
      return addSecurityHeaders(NextResponse.json(
        { error: 'Invalid request origin' },
        { status: 403 }
      ))
    }

    const supabase = await createClient()

    // Get the user from the request (using cookies)
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return addSecurityHeaders(NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      ))
    }

    // Get tenant context from cookie
    const { getCurrentTenantId } = await import('@/lib/tenant/context')
    const tenantId = await getCurrentTenantId()

    // Check tenant membership with owner/admin role
    const { data: membership, error: membershipError } = await supabase
      .from('tenant_memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .single()

    if (membershipError || !membership) {
      return addSecurityHeaders(NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      ))
    }

    return {
      user,
      membership,
      userId: user.id,
      tenantId,
      sessionInfo: {
        age: 0,
        ip: getClientIP(request)
      }
    }
  } catch (error) {
    console.error('Admin auth middleware error:', error)
    return addSecurityHeaders(NextResponse.json(
      { error: 'Authentication error' },
      { status: 500 }
    ))
  }
}

/**
 * Extract client IP for logging and security
 */
function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  
  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }
  
  return 'unknown'
}

export const isAdminAuthSuccess = (result: AdminAuthResult): result is AdminAuthSuccess => {
  return 'userId' in result
}
