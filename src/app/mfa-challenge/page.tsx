'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

function MFAChallengeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = searchParams.get('return') || '/platform'

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const verifyMFA = async () => {
    if (!code || code.length !== 6) {
      setError('Please enter a valid 6-digit code')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const factors = await supabase.auth.mfa.listFactors()

      if (factors.error || !factors.data?.totp?.[0]) {
        setError('MFA is not configured for your account')
        return
      }

      const factorId = factors.data.totp[0].id

      const challenge = await supabase.auth.mfa.challenge({ factorId })
      if (challenge.error) {
        setError(challenge.error.message)
        return
      }

      const verify = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code,
      })

      if (verify.error) {
        setError(verify.error.message)
        return
      }

      // MFA verified successfully - redirect to return URL
      router.push(returnUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && code.length === 6) {
      verifyMFA()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold mb-4 text-gray-900">Two-Factor Authentication</h1>
        <p className="text-gray-600 mb-6">
          Enter the 6-digit code from your authenticator app to continue.
        </p>

        <div className="space-y-4">
          <Input
            label="Verification Code"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={handleKeyDown}
            maxLength={6}
            error={error || undefined}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            autoFocus
          />
          <Button
            onClick={verifyMFA}
            fullWidth
            isLoading={isLoading}
            disabled={isLoading || code.length !== 6}
          >
            {isLoading ? 'Verifying...' : 'Verify'}
          </Button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Having trouble? Contact your platform administrator for assistance.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function MFAChallengePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <MFAChallengeContent />
    </Suspense>
  )
}
