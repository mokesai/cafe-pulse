'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createTenant, resendInvite, connectSquareCredentials } from '../actions'
import { ENV } from '@/lib/constants/app'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import type { ActionState } from '../actions'

// Step 1 schema - same as Server Action
const step1Schema = z.object({
  slug: z.string()
    .min(3, 'Slug must be at least 3 characters')
    .max(50, 'Slug must be less than 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
    .refine(s => !s.startsWith('-') && !s.endsWith('-'), 'Slug cannot start or end with hyphen'),
  name: z.string()
    .min(1, 'Business name is required')
    .max(200, 'Business name must be less than 200 characters'),
  admin_email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must be less than 255 characters'),
})

type Step1FormData = z.infer<typeof step1Schema>

export default function OnboardNewTenantPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [successResult, setSuccessResult] = useState<ActionState | null>(null)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [resendError, setResendError] = useState<string | null>(null)
  const [squareStatus, setSquareStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [squareError, setSquareError] = useState<string | null>(null)
  const router = useRouter()

  // React Hook Form for Step 1
  const form = useForm<Step1FormData>({
    resolver: zodResolver(step1Schema),
    defaultValues: { slug: '', name: '', admin_email: '' },
  })

  // Step 1 submit handler
  const onStep1Submit = async (data: Step1FormData) => {
    const formDataObj = new FormData()
    formDataObj.append('slug', data.slug)
    formDataObj.append('name', data.name)
    formDataObj.append('admin_email', data.admin_email)

    const result = await createTenant({ errors: {} }, formDataObj)

    if (result.success && result.tenantId) {
      setSuccessResult(result)
      setCurrentStep(3)
    } else if (result.errors) {
      if (result.errors.slug) form.setError('slug', { message: result.errors.slug[0] })
      if (result.errors.name) form.setError('name', { message: result.errors.name[0] })
      if (result.errors.admin_email) form.setError('admin_email', { message: result.errors.admin_email[0] })
      if (result.errors._form) form.setError('root', { message: result.errors._form[0] })
    }
  }

  // Manual credentials handler
  const handleSquareConnect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!successResult?.tenantId) return
    setSquareStatus('saving')
    setSquareError(null)
    const formData = new FormData(e.currentTarget)
    const result = await connectSquareCredentials(successResult.tenantId, formData)
    if (result.success) {
      setSquareStatus('saved')
    } else {
      setSquareStatus('error')
      setSquareError(result.errors?._form?.[0] ?? 'Failed to save credentials')
    }
  }

  const handleResendInvite = async () => {
    if (!successResult?.tenantId) return
    setResendStatus('sending')
    setResendError(null)
    const result = await resendInvite(successResult.tenantId)
    if (result.success) {
      setResendStatus('sent')
    } else {
      setResendStatus('error')
      setResendError(result.error ?? 'Failed to resend invite')
    }
  }

  // Step 3: Success summary
  if (currentStep === 3 && successResult) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-green-600 mb-2">Tenant Created</h1>
          <p className="text-gray-600">The tenant has been onboarded successfully.</p>
        </div>

        {/* Tenant summary */}
        <div className="bg-white rounded-lg shadow p-6 mb-4 space-y-3">
          <h2 className="text-lg font-semibold mb-3">Summary</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Business Name</dt>
              <dd className="font-medium">{successResult.tenantName}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Slug</dt>
              <dd className="font-mono">{successResult.tenantSlug}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Admin Email</dt>
              <dd className="font-medium">{successResult.adminEmail}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Square</dt>
              <dd className={squareStatus === 'saved' ? 'text-green-600' : 'text-yellow-600'}>
                {squareStatus === 'saved' ? 'Connected' : 'Not connected yet'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Invite status */}
        <div className="bg-white rounded-lg shadow p-6 mb-4">
          <h2 className="text-lg font-semibold mb-3">Admin Invite</h2>
          {successResult.inviteSuccess ? (
            <div className="flex items-center gap-2 text-green-700">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>
                {successResult.userExists ? (
                  <>User <strong>{successResult.adminEmail}</strong> can access this tenant by logging in</>
                ) : (
                  <>Invite email sent to <strong>{successResult.adminEmail}</strong></>
                )}
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-red-700">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Invite email failed: {successResult.inviteError}</span>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleResendInvite}
                  isLoading={resendStatus === 'sending'}
                  size="sm"
                  variant="outline"
                  disabled={resendStatus === 'sent'}
                >
                  {resendStatus === 'sent' ? 'Invite Sent' : 'Retry Invite'}
                </Button>
                {resendStatus === 'sent' && (
                  <span className="text-green-600 text-sm">Invite sent successfully</span>
                )}
                {resendStatus === 'error' && resendError && (
                  <span className="text-red-600 text-sm">{resendError}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Connect Square */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-lg font-semibold">Connect Square</h2>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${ENV.SQUARE_ENVIRONMENT === 'production' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {ENV.SQUARE_ENVIRONMENT === 'production' ? 'Production' : 'Sandbox'}
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            Enter credentials from your{' '}
            <a href="https://developer.squareup.com/apps" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              Square Developer Dashboard
            </a>. You can also configure this later from the tenant detail page.
          </p>
          {squareStatus === 'saved' ? (
            <div className="flex items-center gap-2 text-green-700">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Square credentials saved</span>
            </div>
          ) : (
            <form onSubmit={handleSquareConnect} className="space-y-3">
              <div>
                <label htmlFor="application_id" className="block text-sm font-medium text-gray-700 mb-1">
                  Application ID
                </label>
                <Input
                  id="application_id"
                  name="application_id"
                  placeholder={ENV.SQUARE_ENVIRONMENT === 'production' ? 'sq0idb-...' : 'sandbox-sq0idb-...'}
                  required
                />
              </div>
              <div>
                <label htmlFor="access_token" className="block text-sm font-medium text-gray-700 mb-1">
                  Access Token
                </label>
                <Input
                  id="access_token"
                  name="access_token"
                  placeholder="EAAAl..."
                  required
                />
              </div>
              <div>
                <label htmlFor="location_id" className="block text-sm font-medium text-gray-700 mb-1">
                  Location ID
                </label>
                <Input
                  id="location_id"
                  name="location_id"
                  placeholder="L..."
                  required
                />
              </div>
              {squareStatus === 'error' && squareError && (
                <p className="text-red-600 text-sm">{squareError}</p>
              )}
              <Button type="submit" isLoading={squareStatus === 'saving'} size="sm">
                Save Credentials
              </Button>
            </form>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button onClick={() => router.push('/platform/tenants')}>
            View All Tenants
          </Button>
          <Button
            onClick={() => router.push(`/platform/tenants/${successResult.tenantId}`)}
            variant="outline"
          >
            View Tenant
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Onboard New Tenant</h1>

      {/* Progress indicator */}
      <div className="flex items-center mb-8 gap-2">
        <div className={`flex-1 h-1 rounded ${currentStep >= 1 ? 'bg-blue-500' : 'bg-gray-300'}`} />
        <div className={`flex-1 h-1 rounded ${currentStep >= 2 ? 'bg-blue-500' : 'bg-gray-300'}`} />
      </div>

      {/* Step 1: Basic Info */}
      {currentStep === 1 && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onStep1Submit)} className="space-y-4">
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tenant Slug</FormLabel>
                  <FormControl>
                    <Input placeholder="my-cafe" {...field} />
                  </FormControl>
                  <FormDescription>
                    Subdomain for this tenant (e.g., my-cafe.yourdomain.com)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Coffee Shop" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="admin_email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Admin Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="admin@mycafe.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    An invite will be sent to this email address
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <p className="text-red-600 text-sm">{form.formState.errors.root.message}</p>
            )}

            <Button type="submit" isLoading={form.formState.isSubmitting}>
              Create Tenant &amp; Send Invite
            </Button>
          </form>
        </Form>
      )}
    </div>
  )
}
