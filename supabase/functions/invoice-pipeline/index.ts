/**
 * Edge Function Entry Point — Invoice Pipeline
 *
 * Receives Supabase Database Webhook payloads on invoice INSERT events.
 * Filters for status='uploaded' and delegates to the pipeline orchestrator.
 *
 * Trigger: Supabase Database Webhook on public.invoices INSERT
 * See: WEBHOOK_SETUP.md for configuration instructions.
 *
 * Architecture: §2.2
 * Runtime: Deno (Supabase Edge Function)
 */

import { serve } from 'std/http/server.ts'
import { runInvoicePipeline } from './orchestrator.ts'

// ============================================================
// Webhook payload shape from Supabase Database Webhooks
// ============================================================

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: {
    id: string
    tenant_id: string
    status: string
    [key: string]: unknown
  } | null
  old_record: unknown
}

// ============================================================
// Main handler
// ============================================================

serve(async (req: Request) => {
  // ── CORS preflight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  // ── Verify request method ───────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── Optional: verify webhook secret (HMAC) ──────────────────────────────
  // When PIPELINE_WEBHOOK_SECRET is set, validate the Authorization header.
  // Supabase sends: Authorization: Bearer <secret> in webhook headers.
  const webhookSecret = Deno.env.get('PIPELINE_WEBHOOK_SECRET')
  if (webhookSecret) {
    const authHeader = req.headers.get('Authorization')
    const expectedAuth = `Bearer ${webhookSecret}`
    if (authHeader !== expectedAuth) {
      console.warn('[index] Unauthorized webhook request — invalid Authorization header')
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  // ── Parse webhook payload ───────────────────────────────────────────────
  let payload: WebhookPayload
  try {
    payload = await req.json() as WebhookPayload
  } catch (err) {
    console.error('[index] Failed to parse webhook payload:', err)
    return new Response(
      JSON.stringify({ error: 'Invalid JSON payload' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── Filter: only process INSERT events on uploaded invoices ──────────────
  if (payload.type !== 'INSERT') {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: 'not_insert_event' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (payload.table !== 'invoices') {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: 'not_invoices_table' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const record = payload.record
  if (!record) {
    return new Response(
      JSON.stringify({ error: 'Missing record in webhook payload' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (record.status !== 'uploaded') {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: 'status_not_uploaded', status: record.status }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const { id: invoiceId, tenant_id: tenantId } = record

  if (!invoiceId || !tenantId) {
    console.error('[index] Missing invoiceId or tenantId in webhook record:', record)
    return new Response(
      JSON.stringify({ error: 'Missing invoiceId or tenantId in webhook record' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── Validate environment variables ──────────────────────────────────────
  if (!Deno.env.get('SUPABASE_URL')) {
    console.error('[index] SUPABASE_URL not set')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    console.error('[index] SUPABASE_SERVICE_ROLE_KEY not set')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!Deno.env.get('OPENROUTER_API_KEY')) {
    console.error('[index] OPENROUTER_API_KEY not set')
    return new Response(
      JSON.stringify({ error: 'Server configuration error: OPENROUTER_API_KEY missing' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  console.log(JSON.stringify({
    event: 'webhook_received',
    invoice_id: invoiceId,
    tenant_id: tenantId,
    table: payload.table,
    type: payload.type,
    timestamp: new Date().toISOString(),
  }))

  // ── Run pipeline ────────────────────────────────────────────────────────
  // Edge Function stays alive until runInvoicePipeline() completes (up to 150s)
  try {
    await runInvoicePipeline(invoiceId, tenantId)

    return new Response(
      JSON.stringify({ ok: true, invoiceId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[index] Unhandled pipeline error for invoice', invoiceId, ':', errorMessage)

    // Return 500 — Supabase will retry the webhook (up to 3 times)
    // The orchestrator's idempotency lock will prevent duplicate processing
    return new Response(
      JSON.stringify({ error: errorMessage.slice(0, 300) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
