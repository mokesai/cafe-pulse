'use client'

import { useEffect } from 'react'

/**
 * Tiny client helper for the awaiting page — reloads the page after
 * `intervalMs` so the server component re-evaluates whether the operator
 * has bound the screen yet. Server-side `redirect()` in the parent page
 * does the actual hand-off to the v3 renderer.
 */
export default function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  useEffect(() => {
    const id = setTimeout(() => {
      window.location.reload()
    }, intervalMs)
    return () => clearTimeout(id)
  }, [intervalMs])
  return null
}
