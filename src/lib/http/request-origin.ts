/**
 * MOK-166 — derive a request's origin from the `Host` header (plus
 * `x-forwarded-proto` when present), with `request.nextUrl.origin` as the
 * fallback.
 *
 * Why this exists: in Next.js 15 dev mode with `npm run dev -- -H 0.0.0.0`,
 * `request.nextUrl.origin` reports the server's bind address (e.g.
 * `http://localhost:3000`) rather than the request's actual Host header.
 * That's a problem for any route that interpolates the origin into a
 * response payload — the Pi setup-script generator (`/api/kds/setup/[code]`)
 * was baking `API_BASE=http://localhost:3000` into the downloaded bash,
 * which the Pi then couldn't reach.
 *
 * The Host header is what the client used to address us, which is what we
 * want to echo back. We honor `x-forwarded-proto` when a proxy / load
 * balancer sets it; otherwise we infer from `nextUrl.protocol`, defaulting
 * to `http` for the dev case.
 */
import type { NextRequest } from 'next/server'

/**
 * Accept either a NextRequest (production) or a plain Request (test
 * harness). NextRequest exposes a `nextUrl` we'd prefer to consult for
 * fallback protocol, but we shouldn't crash if it's missing.
 */
type AnyRequest = NextRequest | Request

function getProtocolFromUrl(request: AnyRequest): string | null {
  const nextUrl = (request as NextRequest).nextUrl
  if (nextUrl?.protocol) return nextUrl.protocol.replace(/:$/, '')
  try {
    return new URL(request.url).protocol.replace(/:$/, '') || null
  } catch {
    return null
  }
}

function getOriginFallback(request: AnyRequest): string {
  const nextUrl = (request as NextRequest).nextUrl
  if (nextUrl?.origin) return nextUrl.origin
  try {
    return new URL(request.url).origin
  } catch {
    return 'http://localhost'
  }
}

export function getRequestOrigin(request: AnyRequest): string {
  const host = request.headers.get('host')
  if (!host) return getOriginFallback(request)

  const forwardedProto = request.headers.get('x-forwarded-proto')
  // x-forwarded-proto can be a comma-separated list (first hop wins).
  const proto =
    forwardedProto?.split(',')[0]?.trim() ||
    getProtocolFromUrl(request) ||
    'http'

  return `${proto}://${host}`
}
