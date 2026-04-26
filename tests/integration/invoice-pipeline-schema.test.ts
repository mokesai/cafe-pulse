import { describe, it, expect } from 'vitest'

import { getServiceClient } from './helpers/tenant'

/**
 * Schema-contract tests for the invoice pipeline edge function.
 *
 * The edge function (Deno runtime) issues raw Supabase queries that reference
 * specific column names. If anyone renames or drops a column, the queries
 * silently start erroring at runtime — the orchestrator's `// never fatal`
 * stages can swallow the error and let the pipeline auto-confirm broken
 * invoices. MOK-116 and MOK-119 were both this exact failure mode, undetected
 * for ~5 weeks.
 *
 * Each test mirrors the SELECT clause of the corresponding edge-function
 * query as faithfully as possible. We don't assert returned data — only that
 * Postgres accepts the query against the actual schema. A missing column
 * surfaces as a 42703 error.
 *
 * If any test here fails, the corresponding edge function stage is broken
 * and needs the column reference updated to match the schema. Do NOT loosen
 * the test to make it pass — fix the edge function (or the migration that
 * dropped the column).
 */
describe('Invoice pipeline schema contract', () => {
  describe('stage 1 — extract (saveExtractedData)', () => {
    it('SELECT for duplicate-invoice check matches schema', async () => {
      // 01-extract.ts: select('id, invoice_number, total_amount, updated_at')
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoices')
        .select('id, invoice_number, total_amount, updated_at')
        .limit(1)
      expect(error).toBeNull()
    })

    it('UPDATE columns on invoices exist (header save)', async () => {
      // 01-extract.ts saveExtractedData updates these columns.
      // SELECT them all to confirm they exist on the schema.
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoices')
        .select(
          'invoice_number, invoice_date, total_amount, vision_confidence, ' +
          'pipeline_stage, supplier_fees, total_fees, fee_source, status'
        )
        .limit(1)
      expect(error).toBeNull()
    })

    it('SELECT/INSERT columns on invoice_items exist', async () => {
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoice_items')
        .select(
          'invoice_id, tenant_id, line_number, item_description, ' +
          'supplier_item_code, quantity, unit_price, total_price, ' +
          'package_size, unit_type, units_per_package, vision_item_confidence, ' +
          'is_reviewed'
        )
        .limit(1)
      expect(error).toBeNull()
    })
  })

  describe('stage 2 — resolve supplier', () => {
    it('SELECT from suppliers matches schema', async () => {
      const svc = getServiceClient()
      const { error } = await svc
        .from('suppliers')
        .select('id, name, tenant_id')
        .limit(1)
      expect(error).toBeNull()
    })
  })

  describe('stage 3 — match PO (regression: MOK-116, MOK-117)', () => {
    it('SELECT from purchase_orders matches schema (MOK-116 regression)', async () => {
      // 03-match-po.ts auto-matcher query.
      // Pre-MOK-116 this referenced `po_number` (column doesn't exist).
      const svc = getServiceClient()
      const { error } = await svc
        .from('purchase_orders')
        .select('id, order_number, supplier_id, total_amount, status, order_date, tenant_id')
        .limit(1)
      expect(error).toBeNull()
    })

    it('SELECT from order_invoice_matches for manual-match check (MOK-117)', async () => {
      // 03-match-po.ts manual-match short-circuit query.
      const svc = getServiceClient()
      const { error } = await svc
        .from('order_invoice_matches')
        .select('id, purchase_order_id, match_method')
        .limit(1)
      expect(error).toBeNull()
    })

    it('INSERT columns for order_invoice_matches exist', async () => {
      // 03-match-po.ts inserts these columns when an auto-match succeeds.
      const svc = getServiceClient()
      const { error } = await svc
        .from('order_invoice_matches')
        .select('tenant_id, invoice_id, purchase_order_id, match_method, match_confidence, status')
        .limit(1)
      expect(error).toBeNull()
    })
  })

  describe('stage 4 — match items (regression: MOK-119)', () => {
    it('SELECT from invoice_items matches schema', async () => {
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoice_items')
        .select(
          'id, invoice_id, tenant_id, line_number, item_description, ' +
          'supplier_item_code, quantity, unit_price, total_price'
        )
        .limit(1)
      expect(error).toBeNull()
    })

    it('SELECT from inventory_items with deleted_at soft-delete (MOK-119 regression)', async () => {
      // 04-match-items.ts. Pre-MOK-119 this referenced `sku` and `is_active`,
      // neither of which exists. The query errored on every pipeline run.
      const svc = getServiceClient()
      const { error } = await svc
        .from('inventory_items')
        .select('id, item_name, unit_cost, tenant_id')
        .is('deleted_at', null)
        .limit(1)
      expect(error).toBeNull()
    })

    it('UPDATE columns on invoice_items exist (match result)', async () => {
      // applyItemMatch updates these.
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoice_items')
        .select('matched_item_id, match_confidence, match_method, is_reviewed')
        .limit(1)
      expect(error).toBeNull()
    })

    it('SELECT from purchase_order_items for quantity variance check (MOK-119)', async () => {
      // checkQuantityVariance — column is `quantity_ordered`, not `quantity`.
      // The original code referenced `quantity`; the regression test catches
      // the mismatch.
      const svc = getServiceClient()
      const { error } = await svc
        .from('purchase_order_items')
        .select('id, quantity_ordered, inventory_item_id, tenant_id, purchase_order_id')
        .limit(1)
      expect(error).toBeNull()
    })

    it('SELECT order_number from purchase_orders for variance message', async () => {
      // checkQuantityVariance — pre-MOK-116 this was `po_number`.
      const svc = getServiceClient()
      const { error } = await svc
        .from('purchase_orders')
        .select('order_number')
        .limit(1)
      expect(error).toBeNull()
    })

    it('SELECT from supplier_item_aliases matches schema', async () => {
      // alias-service.ts.
      const svc = getServiceClient()
      const { error } = await svc
        .from('supplier_item_aliases')
        .select(
          'id, tenant_id, supplier_id, supplier_description, inventory_item_id, ' +
          'confidence, source, use_count, last_seen_invoice_id, last_seen_at, ' +
          'created_at, updated_at'
        )
        .limit(1)
      expect(error).toBeNull()
    })
  })

  describe('stage 5 — confirm', () => {
    it('UPDATE columns on invoices exist (confirmation)', async () => {
      // 05-confirm.ts.
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoices')
        .select('status, pipeline_stage, pipeline_completed_at, open_exception_count')
        .limit(1)
      expect(error).toBeNull()
    })

    it('SELECT from invoice_exceptions for price-variance dedup', async () => {
      // updateInventoryCosts.
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoice_exceptions')
        .select('invoice_item_id, exception_type, status')
        .limit(1)
      expect(error).toBeNull()
    })

    it('SELECT from invoices for fee distribution', async () => {
      // distributeSupplierFees.
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoices')
        .select('id, total_fees, fee_cogs_distributed, invoice_number')
        .limit(1)
      expect(error).toBeNull()
    })

    it('inventory_item_cost_history columns exist (fee allocation INSERT)', async () => {
      const svc = getServiceClient()
      const { error } = await svc
        .from('inventory_item_cost_history')
        .select(
          'tenant_id, inventory_item_id, previous_unit_cost, new_unit_cost, ' +
          'pack_size, source, source_ref, notes, changed_by, fee_amount'
        )
        .limit(1)
      expect(error).toBeNull()
    })
  })

  describe('exceptions', () => {
    it('invoice_exceptions INSERT columns match schema', async () => {
      // exceptions.ts createException.
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoice_exceptions')
        .select(
          'tenant_id, invoice_id, invoice_item_id, exception_type, ' +
          'exception_message, exception_context, pipeline_stage_at_creation, status'
        )
        .limit(1)
      expect(error).toBeNull()
    })

    it('invoice_exceptions has severity column with info/block constraint (MOK-121)', async () => {
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoice_exceptions')
        .select('id, severity')
        .limit(1)
      expect(error).toBeNull()
    })
  })

  describe('variance history (MOK-122)', () => {
    it('invoice_variance_history INSERT columns match schema', async () => {
      // 04-match-items.ts recordVariance.
      const svc = getServiceClient()
      const { error } = await svc
        .from('invoice_variance_history')
        .select(
          'tenant_id, invoice_id, invoice_item_id, purchase_order_id, ' +
          'supplier_id, variance_type, severity, po_quantity, invoice_quantity, ' +
          'po_unit_cost, invoice_unit_price, po_description, invoice_description, ' +
          'variance_pct, threshold_pct, related_exception_id, ' +
          'acknowledged_at, acknowledged_by, acknowledgment_notes, created_at'
        )
        .limit(1)
      expect(error).toBeNull()
    })
  })
})
