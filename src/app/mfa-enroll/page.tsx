'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

function MFAEnrollContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = searchParams.get('return') || '/platform'

  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const enrollMFA = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // Remove any existing factors before enrolling a fresh one
      const { data: existingFactors } = await supabase.auth.mfa.listFactors()
      if (existingFactors?.all) {
        for (const factor of existingFactors.all) {
          await supabase.auth.mfa.unenroll({ factorId: factor.id })
        }
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Cafe Pulse Authenticator',
      })

      if (error) {
        setError(error.message)
        return
      }

      if (data) {
        setFactorId(data.id)
        if (data.totp) {
          setQrCode(data.totp.qr_code)
          setSecret(data.totp.secret)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enroll MFA')
    } finally {
      setIsLoading(false)
    }
  }

  const verifyAndEnable = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      setError('Please enter a valid 6-digit code')
      return
    }

    if (!factorId) {
      setError('MFA enrollment not found. Please refresh and try again.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: verifyCode,
      })

      if (error) {
        setError(error.message)
        return
      }

      // MFA enabled successfully - redirect to return URL
      router.push(returnUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  if (!qrCode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-lg">
          <h1 className="text-2xl font-bold mb-4 text-gray-900">Enable Two-Factor Authentication</h1>
          <p className="text-gray-600 mb-6">
            Platform admin access requires multi-factor authentication (MFA). Click below to set up an authenticator app.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            You&apos;ll need an authenticator app like Google Authenticator, Authy, or 1Password to scan a QR code.
          </p>
          <Button
            onClick={enrollMFA}
            fullWidth
            isLoading={isLoading}
            disabled={isLoading}
          >
            {isLoading ? 'Setting up...' : 'Set Up MFA'}
          </Button>
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold mb-4 text-gray-900">Scan QR Code</h1>
        <p className="text-gray-600 mb-4">
          Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
        </p>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="MFA QR Code" className="w-full" />
        </div>

        <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-xs font-medium text-blue-900 mb-1">Manual entry code:</p>
          <p className="text-sm font-mono text-blue-700 break-all">{secret}</p>
        </div>

        <div className="space-y-4">
          <Input
            label="Verification Code"
            placeholder="Enter 6-digit code"
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
            maxLength={6}
            error={error || undefined}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
          />
          <Button
            onClick={verifyAndEnable}
            fullWidth
            isLoading={isLoading}
            disabled={isLoading || verifyCode.length !== 6}
          >
            {isLoading ? 'Verifying...' : 'Verify and Enable'}
          </Button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MFAEnrollPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <MFAEnrollContent />
    </Suspense>
  )
}
