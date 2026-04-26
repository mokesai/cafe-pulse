/**
 * MOK-131 — refreshSignedUrl mints a fresh storage URL on every pipeline run.
 *
 * The upload route stores a 24h-expiry signed URL on invoices.file_url. On
 * Re-run pipeline (MOK-127) for any invoice older than 24h, that URL returns
 * HTTP 400 from Supabase storage. The fix: regenerate the URL from the stable
 * file_path at the start of stage 1, with a short (10 min) TTL.
 *
 * Run: deno test __tests__/01-extract-refresh-signed-url.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
  assertExists,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import { refreshSignedUrl, SIGNED_URL_TTL_SECONDS } from '../stages/01-extract.ts'
import type { PipelineContext } from '../context.ts'

interface CreateSignedUrlCall {
  bucket: string
  path: string
  ttl: number
}

/**
 * Build a minimal PipelineContext with a recording stub for
 * supabase.storage.from('invoices').createSignedUrl(path, ttl).
 */
function makeCtx(overrides: {
  filePath?: string | null
  fileUrl?: string
  signedUrlResponse?: { data: { signedUrl: string } | null; error: { message: string } | null }
}): { ctx: PipelineContext; calls: CreateSignedUrlCall[] } {
  const calls: CreateSignedUrlCall[] = []
  const response = overrides.signedUrlResponse ?? {
    data: { signedUrl: 'https://fresh.invoices/signed?token=abc' },
    error: null,
  }

  const supabase = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => {
          calls.push({ bucket, path, ttl })
          return response
        },
      }),
    },
  } as unknown as PipelineContext['supabase']

  const ctx: PipelineContext = {
    invoiceId: 'inv-1',
    tenantId: 'tenant-1',
    supabase,
    tenantSettings: {
      noPomatchBehavior: 'always_create',
      priceVarianceThresholdPct: 10,
      totalVarianceThresholdPct: 5,
      matchConfidenceThresholdPct: 85,
      visionConfidenceThresholdPct: 60,
    },
    invoice: {
      file_url: overrides.fileUrl ?? 'https://stale.invoices/old?token=xyz',
      file_path: overrides.filePath === undefined ? 'tenant-1/inv.pdf' : (overrides.filePath ?? ''),
      file_type: 'pdf',
      supplier_id: null,
      invoice_number: null,
    },
    parsedData: null,
    resolvedSupplierId: null,
    poMatchId: null,
    matchedItemCount: 0,
    skippedItemCount: 0,
    openExceptionCount: 0,
    hasBlockingExceptions: false,
    pipelineStartedAt: new Date().toISOString(),
  }

  return { ctx, calls }
}

Deno.test('refreshSignedUrl — mints fresh URL from file_path with the configured TTL', async () => {
  const { ctx, calls } = makeCtx({
    filePath: 'tenant-1/abc/123.pdf',
  })

  const url = await refreshSignedUrl(ctx)

  assertEquals(calls.length, 1)
  assertEquals(calls[0].bucket, 'invoices')
  assertEquals(calls[0].path, 'tenant-1/abc/123.pdf')
  assertEquals(calls[0].ttl, SIGNED_URL_TTL_SECONDS)
  assertEquals(url, 'https://fresh.invoices/signed?token=abc')
})

Deno.test('refreshSignedUrl — returns null when storage createSignedUrl errors', async () => {
  const { ctx } = makeCtx({
    signedUrlResponse: {
      data: null,
      error: { message: 'Object not found' },
    },
  })

  const url = await refreshSignedUrl(ctx)

  assertEquals(url, null)
})

Deno.test('refreshSignedUrl — falls back to stored file_url when file_path is empty (legacy row)', async () => {
  const { ctx, calls } = makeCtx({
    filePath: '',
    fileUrl: 'https://stale-but-only-option.invoices/legacy?token=xyz',
  })

  const url = await refreshSignedUrl(ctx)

  // Did NOT call createSignedUrl — nothing to mint from
  assertEquals(calls.length, 0)
  // Returned the stored URL as a defensive fallback
  assertEquals(url, 'https://stale-but-only-option.invoices/legacy?token=xyz')
})

Deno.test('refreshSignedUrl — returns null when both file_path and file_url are missing', async () => {
  const { ctx } = makeCtx({
    filePath: '',
    fileUrl: '',
  })

  const url = await refreshSignedUrl(ctx)
  assertEquals(url, null)
})

Deno.test('refreshSignedUrl — does not reuse a previous URL across calls', async () => {
  // Each call should mint a fresh URL — this is the property that makes
  // the fix work for repeated re-runs of the same invoice.
  const responses = [
    { data: { signedUrl: 'https://first/signed' }, error: null },
    { data: { signedUrl: 'https://second/signed' }, error: null },
  ]
  let callIndex = 0
  const supabase = {
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: async (_path: string, _ttl: number) => {
          return responses[callIndex++]
        },
      }),
    },
  } as unknown as PipelineContext['supabase']

  const ctx: PipelineContext = {
    invoiceId: 'inv-1',
    tenantId: 'tenant-1',
    supabase,
    tenantSettings: {
      noPomatchBehavior: 'always_create',
      priceVarianceThresholdPct: 10,
      totalVarianceThresholdPct: 5,
      matchConfidenceThresholdPct: 85,
      visionConfidenceThresholdPct: 60,
    },
    invoice: {
      file_url: 'unused',
      file_path: 'tenant-1/abc/123.pdf',
      file_type: 'pdf',
      supplier_id: null,
      invoice_number: null,
    },
    parsedData: null,
    resolvedSupplierId: null,
    poMatchId: null,
    matchedItemCount: 0,
    skippedItemCount: 0,
    openExceptionCount: 0,
    hasBlockingExceptions: false,
    pipelineStartedAt: new Date().toISOString(),
  }

  const first = await refreshSignedUrl(ctx)
  const second = await refreshSignedUrl(ctx)

  assertExists(first)
  assertExists(second)
  assertEquals(first, 'https://first/signed')
  assertEquals(second, 'https://second/signed')
})
