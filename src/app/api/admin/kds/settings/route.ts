import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { addSecurityHeaders } from '@/lib/security/headers'
import { getSettings, updateSetting } from '@/lib/kds/queries'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { KDS_THEMES } from '@/lib/kds/types'
import type { KDSTheme } from '@/lib/kds/types'

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  try {
    const tenantId = await getCurrentTenantId()
    const settings = await getSettings(tenantId)
    return addSecurityHeaders(NextResponse.json({
      success: true,
      settings,
    }))
  } catch (error) {
    console.error('Failed to fetch KDS settings:', error)
    return addSecurityHeaders(NextResponse.json(
      { error: 'Failed to fetch KDS settings' },
      { status: 500 }
    ))
  }
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  try {
    const tenantId = await getCurrentTenantId()
    const body = await request.json()

    // Validate theme if provided
    if (body.theme !== undefined) {
      if (!KDS_THEMES.includes(body.theme as KDSTheme)) {
        return addSecurityHeaders(NextResponse.json(
          { error: `Invalid theme. Must be one of: ${KDS_THEMES.join(', ')}` },
          { status: 400 }
        ))
      }

      const success = await updateSetting(tenantId, 'theme', body.theme as KDSTheme)
      if (!success) {
        return addSecurityHeaders(NextResponse.json(
          { error: 'Failed to update theme setting' },
          { status: 500 }
        ))
      }
    }

    const settings = await getSettings(tenantId)
    return addSecurityHeaders(NextResponse.json({
      success: true,
      settings,
    }))
  } catch (error) {
    console.error('Failed to update KDS settings:', error)
    return addSecurityHeaders(NextResponse.json(
      { error: 'Failed to update KDS settings' },
      { status: 500 }
    ))
  }
}
