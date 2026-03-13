'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { getPasswordResetRedirect, getInviteRedirect } from './actions'

function UpdatePasswordContent() {
  const searchParams = useSearchParams()
  const flow = searchParams.get('flow') // 'invite' or 'recovery' (default)
  const isInvite = flow === 'invite'

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)

    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        setError(updateError.message)
        return
      }

      if (isInvite) {
        // Invite flow: stay logged in, get tenant login URL, go to MFA enrollment
        const tenantLoginUrl = await getInviteRedirect()
        const encodedReturn = encodeURIComponent(tenantLoginUrl)
        window.location.replace(`/mfa-enroll?flow=invite&return=${encodedReturn}`)
      } else {
        // Recovery flow: sign out and redirect to login
        const redirectUrl = await getPasswordResetRedirect()
        await supabase.auth.signOut()
        window.location.replace(redirectUrl)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-lg">
        <div className="flex justify-center mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cafe-pulse-logo.png" alt="Café Pulse" className="h-12" />
        </div>
        <h1 className="text-2xl font-bold mb-2 text-gray-900 text-center">
          {isInvite ? 'Create Your Password' : 'Set Your Password'}
        </h1>
        <p className="text-gray-600 mb-6 text-center">
          {isInvite
            ? 'Welcome! Set a password to activate your account.'
            : 'Choose a password for your account.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="New Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          <Input
            label="Confirm Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            autoComplete="new-password"
            error={error || undefined}
          />
          <Button
            type="submit"
            fullWidth
            isLoading={isLoading}
            disabled={isLoading || !password || !confirmPassword}
          >
            {isLoading ? 'Updating...' : isInvite ? 'Create Password & Continue' : 'Set Password'}
          </Button>
        </form>

        {isInvite && (
          <p className="text-xs text-gray-500 mt-4 text-center">
            Next step: Set up two-factor authentication
          </p>
        )}
      </div>
    </div>
  )
}

export default function UpdatePasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <UpdatePasswordContent />
    </Suspense>
  )
}
