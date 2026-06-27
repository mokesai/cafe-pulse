/**
 * MOK-165 — unit tests for extractSubdomain.
 *
 * Pre-existing behavior locked in so the IPv4 + `local*` additions don't
 * regress anything: bare localhost, slug.localhost, slug.example.com,
 * bare example.com, vercel.app deployments.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { extractSubdomain } from '../context'

describe('extractSubdomain', () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl
  })

  describe('localhost cases', () => {
    it('returns null for bare localhost', () => {
      expect(extractSubdomain('localhost')).toBeNull()
    })

    it('returns null for bare localhost with port', () => {
      expect(extractSubdomain('localhost:3000')).toBeNull()
    })

    it('extracts slug from slug.localhost', () => {
      expect(extractSubdomain('littlecafe.localhost')).toBe('littlecafe')
    })

    it('extracts slug from slug.localhost:port', () => {
      expect(extractSubdomain('bigcafe.localhost:3000')).toBe('bigcafe')
    })
  })

  describe('IPv4 cases (MOK-165)', () => {
    it('returns null for a private IPv4 address (no port)', () => {
      expect(extractSubdomain('192.168.4.114')).toBeNull()
    })

    it('returns null for a private IPv4 address with port', () => {
      expect(extractSubdomain('192.168.4.114:3000')).toBeNull()
    })

    it('returns null for 10.0.0.1', () => {
      expect(extractSubdomain('10.0.0.1:3000')).toBeNull()
    })

    it('returns null for 127.0.0.1', () => {
      expect(extractSubdomain('127.0.0.1:3000')).toBeNull()
    })

    it('returns null for a public IPv4 address', () => {
      expect(extractSubdomain('8.8.8.8')).toBeNull()
    })
  })

  describe('dev-host local* cases (MOK-165)', () => {
    it('extracts slug from slug.local-macbook (operator dev case)', () => {
      expect(extractSubdomain('bigcafe.local-macbook:3000')).toBe('bigcafe')
    })

    it('extracts slug from slug.local-anything', () => {
      expect(extractSubdomain('foo.local-devbox')).toBe('foo')
    })

    it('extracts slug from slug.local (mDNS-style)', () => {
      // Note: .local is the mDNS TLD; user is responsible for whether this
      // collides with Avahi on their network. The function level just
      // applies the local* rule.
      expect(extractSubdomain('bigcafe.local')).toBe('bigcafe')
    })
  })

  describe('Vercel deployments', () => {
    it('returns null for vercel.app preview URLs', () => {
      expect(
        extractSubdomain('cafe-pulse-abc123-jerrys-projects-998e61b3.vercel.app'),
      ).toBeNull()
    })

    it('returns null for vercel.app branch URLs', () => {
      expect(
        extractSubdomain('cafe-pulse-git-main-jerrys-projects-998e61b3.vercel.app'),
      ).toBeNull()
    })
  })

  describe('production hosts (with NEXT_PUBLIC_SITE_URL set)', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://cafepulse.com'
    })

    it('returns null for bare configured site domain', () => {
      expect(extractSubdomain('cafepulse.com')).toBeNull()
    })

    it('extracts slug from slug.cafepulse.com', () => {
      expect(extractSubdomain('littlecafe.cafepulse.com')).toBe('littlecafe')
    })

    it('extracts slug from deeper subdomains slug.app.cafepulse.com', () => {
      expect(extractSubdomain('bigcafe.app.cafepulse.com')).toBe('bigcafe')
    })
  })

  describe('bare 2-part domains (no siteUrl configured)', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_SITE_URL
    })

    it('returns null for bare example.com (does not mis-extract `example`)', () => {
      // Regression guard for the conservative `local*` heuristic: we
      // deliberately don't generalize the 2-part rule beyond `local*`
      // because we'd start mis-classifying bare prod domains otherwise.
      expect(extractSubdomain('example.com')).toBeNull()
    })

    it('returns null for foo.org', () => {
      expect(extractSubdomain('foo.org')).toBeNull()
    })
  })
})
