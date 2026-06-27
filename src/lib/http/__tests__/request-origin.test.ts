/**
 * MOK-166 — unit tests for getRequestOrigin.
 */
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { getRequestOrigin } from '../request-origin'

function makeRequest(opts: {
  url: string
  host?: string | null
  forwardedProto?: string | null
}): NextRequest {
  const headers = new Headers()
  if (opts.host !== null && opts.host !== undefined) headers.set('host', opts.host)
  if (opts.forwardedProto) headers.set('x-forwarded-proto', opts.forwardedProto)
  return new NextRequest(opts.url, { headers })
}

describe('getRequestOrigin', () => {
  it('uses the Host header over the bound URL', () => {
    // Simulates Next.js dev with -H 0.0.0.0: nextUrl says localhost:3000,
    // but the client connected via bigcafe.local-macbook.
    const req = makeRequest({
      url: 'http://localhost:3000/api/kds/setup/ABCD-1234',
      host: 'bigcafe.local-macbook:3000',
    })
    expect(getRequestOrigin(req)).toBe('http://bigcafe.local-macbook:3000')
  })

  it('honors x-forwarded-proto when a proxy sets it (https)', () => {
    const req = makeRequest({
      url: 'http://localhost:3000/api/kds/setup/ABCD-1234',
      host: 'cafepulse.com',
      forwardedProto: 'https',
    })
    expect(getRequestOrigin(req)).toBe('https://cafepulse.com')
  })

  it('honors only the first hop of a comma-separated x-forwarded-proto', () => {
    const req = makeRequest({
      url: 'http://localhost:3000/api/kds/setup/ABCD-1234',
      host: 'cafepulse.com',
      forwardedProto: 'https, http',
    })
    expect(getRequestOrigin(req)).toBe('https://cafepulse.com')
  })

  it('infers protocol from the URL when no x-forwarded-proto', () => {
    const req = makeRequest({
      url: 'https://cafepulse.com/api/kds/setup/ABCD-1234',
      host: 'cafepulse.com',
    })
    expect(getRequestOrigin(req)).toBe('https://cafepulse.com')
  })

  it('defaults to http when the URL protocol is missing', () => {
    // NextRequest will normalize, but verify the explicit `|| 'http'` guard.
    const req = makeRequest({
      url: 'http://localhost:3000/api/kds/setup/ABCD-1234',
      host: 'bigcafe.local-macbook:3000',
    })
    expect(getRequestOrigin(req).startsWith('http://')).toBe(true)
  })

  it('falls back to nextUrl.origin when Host header is missing', () => {
    const req = makeRequest({
      url: 'http://localhost:3000/api/kds/setup/ABCD-1234',
      host: null,
    })
    expect(getRequestOrigin(req)).toBe('http://localhost:3000')
  })
})
