/**
 * POST /api/admin/cogs/recipes/generate
 *
 * Accepts { product_ids: string[] } — Square product IDs (cogs_products.id)
 * Calls ai-recipe-service to generate recipe estimates.
 * Stores results in ai_recipe_estimates table.
 * Returns estimates.
 *
 * IMPORTANT: Does NOT create cogs_product_recipes rows (AC-19).
 * Human must approve via POST /api/admin/cogs/recipes/[id]/approve.
 *
 * FR-17, AC-19
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import {
  generateRecipeEstimates,
  type SquareProductInput,
  type InventoryItemCandidate,
} from '@/lib/cogs/ai-recipe-service'

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every(v => typeof v === 'string')
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const tenantId = await getCurrentTenantId()
    const supabase = createServiceClient()

    // Parse request body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { product_ids } = body as { product_ids?: unknown }
    if (!isStringArray(product_ids) || product_ids.length === 0) {
      return NextResponse.json(
        { error: 'product_ids must be a non-empty array of strings' },
        { status: 400 }
      )
    }

    if (product_ids.length > 50) {
      return NextResponse.json(
        { error: 'product_ids must contain 50 or fewer items per request' },
        { status: 400 }
      )
    }

    // Fetch the products from cogs_products
    const { data: products, error: productsError } = await supabase
      .from('cogs_products')
      .select('id, square_item_id, name, category')
      .eq('tenant_id', tenantId)
      .in('id', product_ids)

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 })
    }

    if (!products || products.length === 0) {
      return NextResponse.json(
        { error: 'No matching products found for the provided product_ids' },
        { status: 404 }
      )
    }

    // Fetch all active inventory items as ingredient candidates
    const { data: inventoryItems, error: inventoryError } = await supabase
      .from('inventory_items')
      .select('id, item_name, unit_type, unit_cost, is_ingredient')
      .eq('tenant_id', tenantId)
      .order('item_name', { ascending: true })

    if (inventoryError) {
      return NextResponse.json({ error: inventoryError.message }, { status: 500 })
    }

    const candidates: InventoryItemCandidate[] = (inventoryItems ?? []).map(item => ({
      id: item.id as string,
      item_name: item.item_name as string,
      unit_type: (item.unit_type as string) || 'each',
      unit_cost: typeof item.unit_cost === 'number' ? item.unit_cost : 0,
      is_ingredient: Boolean(item.is_ingredient),
    }))

    const productInputs: SquareProductInput[] = products.map(p => ({
      id: p.id as string,
      square_item_id: p.square_item_id as string,
      name: p.name as string,
      category: p.category as string | null,
    }))

    // Generate AI estimates (no DB writes to cogs_product_recipes — AC-19)
    const aiResults = await generateRecipeEstimates(productInputs, candidates)

    // Upsert results into ai_recipe_estimates
    const upsertRows = aiResults.map(result => ({
      tenant_id: tenantId,
      square_product_id: result.product_id,
      product_name: result.product_name,
      estimated_ingredients: result.estimates.map(e => ({
        inventory_item_id: e.inventory_item_id,
        item_name: e.item_name,
        quantity: e.quantity,
        unit: e.unit,
        confidence: e.confidence,
        notes: e.notes,
      })),
      ai_model: result.ai_model,
      ai_confidence: result.overall_confidence,
      ai_reasoning: result.ai_reasoning ?? null,
      review_status: 'pending',
      generated_at: new Date().toISOString(),
    }))

    const { data: savedEstimates, error: upsertError } = await supabase
      .from('ai_recipe_estimates')
      .upsert(upsertRows, {
        onConflict: 'tenant_id,square_product_id',
        ignoreDuplicates: false,
      })
      .select('id, square_product_id, product_name, estimated_ingredients, ai_model, ai_confidence, ai_reasoning, review_status, generated_at')

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    // Annotate saved estimates with is_ai_estimated flag
    const responseData = (savedEstimates ?? []).map(row => ({
      ...row,
      is_ai_estimated: true,
      estimated_ingredients: ((row.estimated_ingredients as unknown[]) ?? []).map(
        (ing) => ({ ...(ing as object), is_ai_estimated: true })
      ),
    }))

    return NextResponse.json({
      success: true,
      data: responseData,
      generated_count: responseData.length,
    })
  } catch (err) {
    console.error('[cogs/recipes/generate] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
