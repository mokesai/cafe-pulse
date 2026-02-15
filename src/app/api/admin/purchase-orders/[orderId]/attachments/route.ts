import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp']
const STORAGE_BUCKET = 'purchase-order-attachments'

type AttachmentRecord = {
  id: string
  purchase_order_id: string
  file_name: string
  file_url: string
  storage_path: string
  file_type: string | null
  file_size: number | null
  uploaded_by: string | null
  notes: string | null
  uploaded_at: string
}

async function enrichWithProfiles(records: AttachmentRecord[]) {
  const ids = Array.from(
    new Set(records.map(record => record.uploaded_by).filter((value): value is string => Boolean(value)))
  )

  if (ids.length === 0) {
    return records.map(record => ({ ...record, uploaded_by_profile: null }))
  }

  const serviceSupabase = createServiceClient()
  const { data: profiles } = await serviceSupabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids)

  const profileMap = new Map((profiles || []).map(profile => [profile.id, profile]))

  return records.map(record => ({
    ...record,
    uploaded_by_profile: record.uploaded_by ? profileMap.get(record.uploaded_by) || null : null
  }))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { orderId } = resolvedParams

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('purchase_order_attachments')
      .select('*')
      .eq('purchase_order_id', orderId)
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch purchase order attachments:', error)
      return NextResponse.json(
        { error: 'Failed to fetch attachments', details: error.message },
        { status: 500 }
      )
    }

    const enriched = await enrichWithProfiles(data || [])

    return NextResponse.json({
      success: true,
      attachments: enriched
    })
  } catch (error) {
    console.error('Error retrieving purchase order attachments:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve purchase order attachments',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const admin = authResult
    const resolvedParams = await params
    const { orderId } = resolvedParams

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const notes = (formData.get('notes') as string | null)?.trim() || null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` },
        { status: 400 }
      )
    }

    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const fileName = file.name.toLowerCase()
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))
    if (!hasValidExtension) {
      return NextResponse.json(
        { error: `Invalid file extension. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}` },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${orderId}/${Date.now()}_${sanitizedName}`

    const buffer = new Uint8Array(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false
      })

    if (uploadError) {
      console.error('Failed to upload attachment to storage:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload attachment', details: uploadError.message },
        { status: 500 }
      )
    }

    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath)

    const fileUrl = publicUrlData?.publicUrl

    if (!fileUrl) {
      console.error('Failed to obtain public URL for attachment:', storagePath)
      return NextResponse.json(
        { error: 'Failed to obtain public URL for attachment' },
        { status: 500 }
      )
    }

    const { data: inserted, error: insertError } = await supabase
      .from('purchase_order_attachments')
      .insert({
        purchase_order_id: orderId,
        file_name: file.name,
        file_url: fileUrl,
        storage_path: storagePath,
        file_type: file.type,
        file_size: file.size,
        uploaded_by: admin.userId,
        notes
      })
      .select('*')
      .single()

    if (insertError || !inserted) {
      console.error('Failed to record purchase order attachment:', insertError)

      // Attempt cleanup
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])

      return NextResponse.json(
        { error: 'Failed to save attachment record', details: insertError?.message },
        { status: 500 }
      )
    }

    const [enrichedAttachment] = await enrichWithProfiles([inserted as AttachmentRecord])

    return NextResponse.json(
      {
        success: true,
        attachment: enrichedAttachment
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error uploading purchase order attachment:', error)
    return NextResponse.json(
      {
        error: 'Failed to upload purchase order attachment',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
