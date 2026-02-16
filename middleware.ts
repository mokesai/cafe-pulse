import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { updateSession } from '@/lib/supabase/middleware'
import { getCachedSiteStatus } from '@/lib/services/siteSettings.edge'
import { extractSubdomain, resolveTenantBySlug } from '@/lib/tenant/context'
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from '@/lib/tenant/types'

function shouldBypassMaintenance(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/under-construction') ||
    pathname === '/favicon.ico'
  ) {
    return true
  }

  return false
}

function applyRewriteWithCookies(
  source: NextResponse,
  destinationUrl: URL
) {
  const rewriteResponse = NextResponse.rewrite(destinationUrl)
  source.headers.forEach((value, key) => {
    if (!['content-length'].includes(key.toLowerCase())) {
      rewriteResponse.headers.set(key, value)
    }
  })
  const cookies = source.cookies.getAll()
  cookies.forEach(cookie => {
    rewriteResponse.cookies.set(cookie)
  })
  return rewriteResponse
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Platform route protection (before session refresh)
  if (pathname.startsWith('/platform')) {
    // Create Supabase client for auth checks
    let supabaseResponse = NextResponse.next({ request })
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // 1. Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL('/login?return=/platform', request.url))
    }

    // 2. Check MFA status
    const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    if (mfaData) {
      const { currentLevel, nextLevel } = mfaData

      if (nextLevel === 'aal2' && currentLevel !== 'aal2') {
        // User has MFA enrolled but hasn't verified this session
        return NextResponse.redirect(new URL('/mfa-challenge?return=/platform', request.url))
      }

      if (currentLevel !== 'aal2' && nextLevel !== 'aal2') {
        // User has NO MFA enrolled - require enrollment
        return NextResponse.redirect(new URL('/mfa-enroll?return=/platform', request.url))
      }
    }

    // 3. Verify platform admin role
    const { data: platformAdmin } = await supabase
      .from('platform_admins')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!platformAdmin) {
      return NextResponse.redirect(new URL('/unauthorized?reason=not-platform-admin', request.url))
    }

    // All checks passed - allow access
    return supabaseResponse
  }

  // 1. Refresh Supabase auth session
  const sessionResponse = await updateSession(request)

  // 2. Resolve tenant from subdomain
  const host = request.headers.get('host') || ''
  const slug = extractSubdomain(host)

  if (slug) {
    const tenant = await resolveTenantBySlug(slug)
    if (tenant) {
      sessionResponse.cookies.set('x-tenant-id', tenant.id, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      })
      sessionResponse.cookies.set('x-tenant-slug', tenant.slug, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      })
    } else {
      // Subdomain provided but tenant not found — return 404
      const notFoundUrl = request.nextUrl.clone()
      notFoundUrl.pathname = '/404'
      return applyRewriteWithCookies(sessionResponse, notFoundUrl)
    }
  } else {
    // No subdomain (bare localhost or bare domain)
    // Set default tenant if no tenant cookie already exists
    if (!request.cookies.get('x-tenant-id')?.value) {
      sessionResponse.cookies.set('x-tenant-id', DEFAULT_TENANT_ID, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      })
      sessionResponse.cookies.set('x-tenant-slug', DEFAULT_TENANT_SLUG, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      })
    }
  }

  // 3. Maintenance mode check
  if (shouldBypassMaintenance(request)) {
    return sessionResponse
  }

  try {
    const status = await getCachedSiteStatus(request)
    if (!status.isCustomerAppLive) {
      const maintenanceUrl = request.nextUrl.clone()
      maintenanceUrl.pathname = '/under-construction'
      maintenanceUrl.searchParams.set('from', request.nextUrl.pathname)
      return applyRewriteWithCookies(sessionResponse, maintenanceUrl)
    }
  } catch (error) {
    console.error('Maintenance gate check failed:', error)
  }

  return sessionResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
