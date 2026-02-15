import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { id } = await context.params
    if (!id) {
      return NextResponse.json(
        { error: 'Invoice ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('file_path, file_url')
      .eq('id', id)
      .single()

    if (error || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    const storagePath = invoice.file_path
    if (!storagePath) {
      return NextResponse.json(
        { error: 'Invoice file path missing' },
        { status: 400 }
      )
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from('invoices')
      .createSignedUrl(storagePath, 60)

    if (signedError || !signed?.signedUrl) {
      console.error('Failed to create signed invoice URL:', signedError)
      return NextResponse.json(
        { error: 'Failed to create signed URL', details: signedError?.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      url: signed.signedUrl
    })
  } catch (error) {
    console.error('Failed to fetch invoice file URL:', error)
    return NextResponse.json(
      { error: 'Failed to fetch invoice file URL', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
