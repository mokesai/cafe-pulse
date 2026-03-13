import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { addSecurityHeaders } from '@/lib/security/headers'
import { getSiteSettings, getSiteStatusUsingServiceClient, saveSiteSettings } from '@/lib/services/siteSettings'

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }
  try {
    const { tenantId } = authResult
    const settings = await getSiteSettings(tenantId)
    const status = await getSiteStatusUsingServiceClient(tenantId)

    return addSecurityHeaders(NextResponse.json({
      success: true,
      settings,
      status
    }))
  } catch (error) {
    console.error('Failed to fetch site settings:', error)
    return addSecurityHeaders(NextResponse.json(
      { error: 'Failed to fetch site settings' },
      { status: 500 }
    ))
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  try {
    const { tenantId } = authResult
    const body = await request.json()

    const allowedKeys = [
      'is_customer_app_live',
      'maintenance_title',
      'maintenance_message',
      'maintenance_cta_label',
      'maintenance_cta_href'
    ]

    const payload: Record<string, unknown> = {}
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        payload[key] = body[key]
      }
    }

    if (Object.keys(payload).length === 0) {
      return addSecurityHeaders(NextResponse.json(
        { error: 'No valid fields provided' },
        { status: 400 }
      ))
    }

    const saved = await saveSiteSettings(tenantId, payload, authResult.userId)
    const status = await getSiteStatusUsingServiceClient(tenantId)

    return addSecurityHeaders(NextResponse.json({
      success: true,
      settings: saved,
      status
    }))
  } catch (error) {
    console.error('Failed to update site settings:', error)
    return addSecurityHeaders(NextResponse.json(
      { error: 'Failed to update site settings' },
      { status: 500 }
    ))
  }
}
