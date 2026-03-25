/**
 * Alias Service — supplier_item_aliases lookup and upsert.
 *
 * Provides fast O(1) alias lookup before fuzzy matching.
 * Manual aliases (source='manual') are never updated by the pipeline.
 *
 * Architecture: §2.1 (alias-service.ts)
 * Runtime: Deno (Supabase Edge Function)
 */

import type { PipelineContext } from './context.ts'

// ============================================================
// Types
// ============================================================

export interface AliasRecord {
  id: string
  tenant_id: string
  supplier_id: string
  supplier_description: string
  inventory_item_id: string
  confidence: number
  source: 'auto' | 'manual'
  use_count: number
  last_seen_invoice_id: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export interface LookupAliasInput {
  supplierId: string
  supplierDescription: string
}

export interface UpsertAliasInput {
  supplierId: string
  supplierDescription: string
  inventoryItemId: string
  confidence: number
  /** Defaults to 'auto'. 'manual' aliases are never updated by pipeline. */
  source?: 'auto' | 'manual'
}

// ============================================================
// lookupAlias()
// ============================================================

/**
 * Look up a supplier item alias by (tenant, supplier, description).
 * Returns the alias record if found, or null.
 *
 * This is called at the start of Stage 4 for each line item.
 * A cache hit bypasses fuzzy matching entirely.
 */
export async function lookupAlias(
  ctx: PipelineContext,
  input: LookupAliasInput
): Promise<AliasRecord | null> {
  const { data, error } = await ctx.supabase
    .from('supplier_item_aliases')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('supplier_id', input.supplierId)
    .eq('supplier_description', input.supplierDescription)
    .maybeSingle()

  if (error) {
    console.warn('[alias-service] lookupAlias error:', error.message)
    return null
  }

  return data as AliasRecord | null
}

// ============================================================
// upsertAlias()
// ============================================================

/**
 * Upsert a supplier item alias. On conflict (same tenant+supplier+description):
 * - If source='manual': skip update entirely (manual corrections are permanent)
 * - If source='auto':   update confidence (rolling max), use_count, and last_seen fields
 *
 * Returns the upserted alias ID.
 */
export async function upsertAlias(
  ctx: PipelineContext,
  input: UpsertAliasInput
): Promise<string | null> {
  const source = input.source ?? 'auto'

  // Check if a manual alias already exists for this description
  const existing = await lookupAlias(ctx, {
    supplierId: input.supplierId,
    supplierDescription: input.supplierDescription,
  })

  if (existing && existing.source === 'manual') {
    // Manual aliases are permanent — pipeline must not overwrite them
    console.log(JSON.stringify({
      event: 'alias_skipped_manual',
      alias_id: existing.id,
      supplier_description: input.supplierDescription,
      invoice_id: ctx.invoiceId,
    }))
    return existing.id
  }

  if (existing && existing.source === 'auto') {
    // Update: rolling max confidence + increment use_count
    const newConfidence = Math.max(existing.confidence, input.confidence)
    const { data, error } = await ctx.supabase
      .from('supplier_item_aliases')
      .update({
        inventory_item_id: input.inventoryItemId,
        confidence: newConfidence,
        use_count: existing.use_count + 1,
        last_seen_invoice_id: ctx.invoiceId,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('tenant_id', ctx.tenantId)
      .select('id')
      .single()

    if (error) {
      console.error('[alias-service] upsertAlias update error:', error.message)
      return null
    }

    console.log(JSON.stringify({
      event: 'alias_updated',
      alias_id: data.id,
      supplier_description: input.supplierDescription,
      old_confidence: existing.confidence,
      new_confidence: newConfidence,
      use_count: existing.use_count + 1,
      invoice_id: ctx.invoiceId,
    }))

    return data.id
  }

  // Insert new alias
  const { data, error } = await ctx.supabase
    .from('supplier_item_aliases')
    .insert({
      tenant_id: ctx.tenantId,
      supplier_id: input.supplierId,
      supplier_description: input.supplierDescription,
      inventory_item_id: input.inventoryItemId,
      confidence: input.confidence,
      source,
      use_count: 1,
      last_seen_invoice_id: ctx.invoiceId,
      last_seen_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    // Check for unique constraint violation (race condition)
    if (error.code === '23505') {
      console.warn('[alias-service] upsertAlias: unique constraint race, retrying lookup')
      const retry = await lookupAlias(ctx, {
        supplierId: input.supplierId,
        supplierDescription: input.supplierDescription,
      })
      return retry?.id ?? null
    }
    console.error('[alias-service] upsertAlias insert error:', error.message)
    return null
  }

  console.log(JSON.stringify({
    event: 'alias_created',
    alias_id: data.id,
    supplier_id: input.supplierId,
    supplier_description: input.supplierDescription,
    inventory_item_id: input.inventoryItemId,
    confidence: input.confidence,
    source,
    invoice_id: ctx.invoiceId,
  }))

  return data.id
}

// ============================================================
// getAllAliasesForSupplier()
// ============================================================

/**
 * Load all aliases for a given supplier in bulk.
 * Used at Stage 4 start to pre-load the alias map (avoids N+1 queries).
 *
 * Returns a Map keyed by supplier_description → AliasRecord
 */
export async function getAllAliasesForSupplier(
  ctx: PipelineContext,
  supplierId: string
): Promise<Map<string, AliasRecord>> {
  const { data, error } = await ctx.supabase
    .from('supplier_item_aliases')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('supplier_id', supplierId)

  if (error) {
    console.warn('[alias-service] getAllAliasesForSupplier error:', error.message)
    return new Map()
  }

  const map = new Map<string, AliasRecord>()
  for (const alias of (data ?? []) as AliasRecord[]) {
    map.set(alias.supplier_description, alias)
  }
  return map
}
