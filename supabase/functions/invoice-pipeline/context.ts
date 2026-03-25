/**
 * PipelineContext — shared state threaded through all pipeline stages.
 *
 * Architecture: §2.3
 * Runtime: Deno (Supabase Edge Function)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Re-export so stages can import from context.ts
export type { SupabaseClient }

// ============================================================
// Tenant Settings
// ============================================================

export interface TenantSettings {
  /** 'always_create' | 'auto_dismiss' | 'notify_continue' */
  noPomatchBehavior: 'always_create' | 'auto_dismiss' | 'notify_continue'
  /** e.g. 10 → 10% price variance threshold */
  priceVarianceThresholdPct: number
  /** e.g. 5 → 5% total variance threshold */
  totalVarianceThresholdPct: number
  /** e.g. 85 → 0.85 normalized in stage code */
  matchConfidenceThresholdPct: number
  /** e.g. 60 → 0.60 normalized in stage code */
  visionConfidenceThresholdPct: number
}

// ============================================================
// Parsed Data Structures
// ============================================================

export interface ParsedLineItem {
  line_number: number
  description: string
  supplier_item_code: string | null
  quantity: number
  unit_price: number
  total_price: number
  package_size: string | null
  unit_type: string | null
  /** GPT-4o Vision per-item confidence (0–1) */
  confidence: number
}

export interface ParsedInvoiceResult {
  invoice_number: string | null
  invoice_date: string | null
  supplier_info: {
    name: string | null
    address: string | null
    phone: string | null
    email: string | null
  }
  subtotal: number | null
  tax_amount: number | null
  total_amount: number | null
  line_items: ParsedLineItem[]
  /** Overall extraction confidence (0–1) */
  overall_confidence: number
  /** How the invoice was extracted */
  extraction_method: 'vision' | 'text_fallback'
}

// ============================================================
// Pipeline Context
// ============================================================

export interface InvoiceRecord {
  file_url: string
  file_path: string
  file_type: string
  supplier_id: string | null
  invoice_number: string | null
  /** Set by Stage 3 if fallback was used during extraction */
  extractionFallbackUsed?: boolean
}

export interface PipelineContext {
  // ── Identifiers ──────────────────────────────────────────
  invoiceId: string
  tenantId: string

  // ── Supabase client (service role — bypasses RLS) ────────
  // All queries MUST include explicit .eq('tenant_id', ctx.tenantId)
  supabase: SupabaseClient

  // ── Tenant config (loaded once at pipeline start) ────────
  tenantSettings: TenantSettings

  // ── Invoice record snapshot ──────────────────────────────
  invoice: InvoiceRecord

  // ── Progressively populated by stages ───────────────────
  /** Set after Stage 1 (extraction) */
  parsedData: ParsedInvoiceResult | null

  /** Set after Stage 2 (supplier resolution) */
  resolvedSupplierId: string | null

  /** Set after Stage 3 (PO matching). null = no PO found */
  poMatchId: string | null

  /** Set after Stage 4 (item matching) */
  matchedItemCount: number

  /** Set after Stage 4 — items skipped below confidence threshold */
  skippedItemCount: number

  /** Incremented whenever createException() is called */
  openExceptionCount: number

  /**
   * True if any exception was created that should gate auto-confirmation.
   * Stage 5 checks this before writing status='confirmed'.
   */
  hasBlockingExceptions: boolean

  /** ISO timestamp captured at pipeline start (for pipeline_started_at) */
  pipelineStartedAt: string
}
