import { NextResponse, type NextRequest } from 'next/server'
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
