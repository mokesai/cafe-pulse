/**
 * Normalize raw JSON from any model into a validated ParsedInvoice.
 * Mirrors normalizeVisionResponse() in
 * supabase/functions/invoice-pipeline/vision-service.ts.
 */

import type { ParsedInvoice, ParsedLineItem } from './types'

interface RawShape {
  invoice_number?: unknown
  invoice_date?: unknown
  supplier_info?: {
    name?: unknown
    address?: unknown
    phone?: unknown
    email?: unknown
  }
  subtotal?: unknown
  tax_amount?: unknown
  total_amount?: unknown
  supplier_fees?: {
    delivery?: unknown
    shipping?: unknown
    processing?: unknown
    other?: unknown
  }
  line_items?: Array<Record<string, unknown>>
  overall_confidence?: unknown
}

export function normalize(raw: unknown): ParsedInvoice {
  const r = (raw ?? {}) as RawShape
  const rawItems = Array.isArray(r.line_items) ? r.line_items : []

  const lineItems: ParsedLineItem[] = rawItems.map((item, index) => ({
    line_number: numberOr(item.line_number, index + 1),
    description: String(item.description ?? 'Unknown Item').trim(),
    supplier_item_code: optString(item.supplier_item_code),
    quantity: clampMin(numberOr(item.quantity, 0), 0),
    unit_price: clampMin(numberOr(item.unit_price, 0), 0),
    total_price: clampMin(numberOr(item.total_price, 0), 0),
    package_size: optString(item.package_size),
    unit_type: optString(item.unit_type),
    confidence: clamp(numberOr(item.confidence, 0.5), 0, 1),
  }))

  const fees = {
    delivery: clampMin(numberOr(r.supplier_fees?.delivery, 0), 0),
    shipping: clampMin(numberOr(r.supplier_fees?.shipping, 0), 0),
    processing: clampMin(numberOr(r.supplier_fees?.processing, 0), 0),
    other: clampMin(numberOr(r.supplier_fees?.other, 0), 0),
  }
  const totalFees = round2(fees.delivery + fees.shipping + fees.processing + fees.other)

  return {
    invoice_number: optString(r.invoice_number),
    invoice_date: optString(r.invoice_date),
    supplier_info: {
      name: optString(r.supplier_info?.name),
      address: optString(r.supplier_info?.address),
      phone: optString(r.supplier_info?.phone),
      email: optString(r.supplier_info?.email),
    },
    subtotal: optNumber(r.subtotal),
    tax_amount: optNumber(r.tax_amount),
    total_amount: optNumber(r.total_amount),
    supplier_fees: fees,
    total_fees: totalFees,
    line_items: lineItems,
    overall_confidence: clamp(numberOr(r.overall_confidence, 0.5), 0, 1),
  }
}

function numberOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function optNumber(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function optString(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
function clampMin(n: number, min: number): number {
  return Math.max(min, n)
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
