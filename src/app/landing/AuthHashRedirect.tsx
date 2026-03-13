'use client'

import { useEffect } from 'react'

/**
 * Detects Supabase auth hash fragments and redirects appropriately:
 * - Success tokens (#access_token=...) → /admin/reset-password to establish session
 * - Error fragments (#error=...) → /admin/login with error message
 */
export default function AuthHashRedirect() {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || hash.length < 2) return

    const params = new URLSearchParams(hash.substring(1))

    if (params.get('access_token')) {
      window.location.replace('/reset-password' + hash)
    } else if (params.get('error')) {
      const description = params.get('error_description') || 'Authentication failed'
      window.location.replace('/admin/login?error=' + encodeURIComponent(description))
    }
  }, [])

  return null
}
