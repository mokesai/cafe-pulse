'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordCallbackPage() {
  const [status, setStatus] = useState('Processing password reset...')

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient()

      // Parse tokens from hash fragment
      const hash = window.location.hash.substring(1)
      const params = new URLSearchParams(hash)
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')

      if (!accessToken || !refreshToken) {
        setStatus('Invalid reset link. Please request a new password reset.')
        return
      }

      // Establish session from the tokens
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })

      if (error) {
        setStatus('Authentication failed: ' + error.message)
        return
      }

      // Session established — redirect to password update form
      // Detect invite vs recovery flow from the hash type param
      const flowType = params.get('type') === 'invite' ? 'invite' : 'recovery'
      window.location.replace(`/update-password?flow=${flowType}`)
    }

    handleCallback()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/cafe-pulse-logo.png" alt="Café Pulse" className="h-12 mx-auto mb-6" />
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-4" />
        <p className="text-gray-600">{status}</p>
      </div>
    </div>
  )
}
