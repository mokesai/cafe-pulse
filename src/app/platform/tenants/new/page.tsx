'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createTenant } from '../actions'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import Input from '@/components/ui/Input'

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
  const [formData, setFormData] = useState<Step1FormData & { tenantId?: string }>({
    slug: '',
    name: '',
    admin_email: '',
  })
  const router = useRouter()
  const searchParams = useSearchParams()

  // Check for OAuth callback success/error
  const success = searchParams.get('success')
  const error = searchParams.get('error')

  // React Hook Form for Step 1
  const form = useForm<Step1FormData>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      slug: formData.slug || '',
      name: formData.name || '',
      admin_email: formData.admin_email || '',
    },
  })

  // Step 1 submit handler
  const onStep1Submit = async (data: Step1FormData) => {
    // Call Server Action directly
    const formDataObj = new FormData()
    formDataObj.append('slug', data.slug)
    formDataObj.append('name', data.name)
    formDataObj.append('admin_email', data.admin_email)

    const result = await createTenant({ errors: {} }, formDataObj)

    if (result.success && result.tenantId) {
      // Save tenant ID and move to step 2
      setFormData({ ...data, tenantId: result.tenantId })
      setCurrentStep(2)
    } else if (result.errors) {
      // Set form errors from server
      if (result.errors.slug) {
        form.setError('slug', { message: result.errors.slug[0] })
      }
      if (result.errors.name) {
        form.setError('name', { message: result.errors.name[0] })
      }
      if (result.errors.admin_email) {
        form.setError('admin_email', { message: result.errors.admin_email[0] })
      }
    }
  }

  // Step 2 Square OAuth handler
  const initiateSquareOAuth = (environment: 'sandbox' | 'production') => {
    const tenantId = formData.tenantId
    router.push(`/api/platform/square-oauth/authorize?tenant_id=${tenantId}&environment=${environment}`)
  }

  // Success state after OAuth callback
  if (success === 'square_connected') {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-green-600 mb-4">
            Tenant Onboarded Successfully
          </h1>
          <p className="text-gray-600 mb-6">
            Square account connected. The tenant is now ready to accept orders.
          </p>
          <Button onClick={() => router.push('/platform/tenants')}>
            View All Tenants
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Onboard New Tenant</h1>

      {/* Error alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-4 mb-6">
          <p className="text-red-800">
            OAuth Error: {error.replace(/_/g, ' ')}
          </p>
        </div>
      )}

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
                    Account will be created for this email address
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" isLoading={form.formState.isSubmitting}>
              Next: Connect Square
            </Button>
          </form>
        </Form>
      )}

      {/* Step 2: Square OAuth */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Connect Square Account</h2>
          <p className="text-gray-600">
            Choose the Square environment to connect:
          </p>

          <div className="space-y-2">
            <Button
              onClick={() => initiateSquareOAuth('sandbox')}
              variant="outline"
              fullWidth
            >
              Connect Sandbox (Testing)
            </Button>
            <Button
              onClick={() => initiateSquareOAuth('production')}
              fullWidth
            >
              Connect Production (Live)
            </Button>
          </div>

          <Button
            onClick={() => setCurrentStep(1)}
            variant="ghost"
          >
            Back
          </Button>
        </div>
      )}
    </div>
  )
}
