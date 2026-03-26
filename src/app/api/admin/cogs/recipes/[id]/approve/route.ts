/**
 * POST /api/admin/cogs/recipes/[id]/approve
 *
 * Promotes an ai_recipe_estimates record to cogs_product_recipes.
 * Accepts optional { approved_ingredients } to override AI estimates.
 *
 * Steps:
 * 1. Load ai_recipe_estimates record
 * 2. Find or create cogs_products row for the square_product_id
 * 3. Insert cogs_product_recipes row
 * 4. Insert cogs_product_recipe_lines for each ingredient
 * 5. Mark ai_recipe_estimates.review_status = 'approved'
 * 6. Set ai_recipe_estimates.promoted_recipe_id
 *
 * FR-17, AC-19
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RecipeIngredient {
  inventory_item_id: string
  quantity: number
  unit: string
  loss_pct?: number
}

function isValidIngredient(val: unknown): val is RecipeIngredient {
  if (!val || typeof val !== 'object') return false
  const v = val as Record<string, unknown>
  return (
    typeof v.inventory_item_id === 'string' &&
    typeof v.quantity === 'number' &&
    v.quantity > 0 &&
    typeof v.unit === 'string'
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing estimate id' }, { status: 400 })
    }

    const tenantId = await getCurrentTenantId()
    const supabase = createServiceClient()

    // Parse optional override ingredients
    let approvedIngredients: RecipeIngredient[] | undefined
    try {
      const body = await request.json().catch(() => ({})) as { approved_ingredients?: unknown }
      if (Array.isArray(body.approved_ingredients)) {
        const valid = body.approved_ingredients.filter(isValidIngredient)
        if (valid.length > 0) approvedIngredients = valid
      }
    } catch {
      // No body — use AI estimates as-is
    }

    // Load the estimate
    const { data: estimate, error: fetchError } = await supabase
      .from('ai_recipe_estimates')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError || !estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    if (estimate.review_status === 'approved') {
      return NextResponse.json(
        { error: 'Estimate is already approved', promoted_recipe_id: estimate.promoted_recipe_id },
        { status: 409 }
      )
    }

    if (estimate.review_status === 'rejected') {
      return NextResponse.json(
        { error: 'Cannot approve a rejected estimate. Generate a new estimate first.' },
        { status: 409 }
      )
    }

    // Determine ingredients to use
    const estimatedIngredients = (estimate.estimated_ingredients as unknown[]) ?? []
    const ingredientsToUse: RecipeIngredient[] = approvedIngredients ?? estimatedIngredients
      .filter(isValidIngredient)

    if (ingredientsToUse.length === 0) {
      return NextResponse.json(
        { error: 'No valid ingredients to promote. Provide approved_ingredients or ensure the estimate has ingredients.' },
        { status: 422 }
      )
    }

    // Find cogs_products row for this square_product_id
    const { data: cogsProduct, error: productError } = await supabase
      .from('cogs_products')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('square_item_id', estimate.square_product_id as string)
      .maybeSingle()

    if (productError) {
      return NextResponse.json({ error: productError.message }, { status: 500 })
    }

    let cogsProductId: string

    if (cogsProduct) {
      cogsProductId = cogsProduct.id as string
    } else {
      // Create cogs_products entry if it doesn't exist
      const { data: newProduct, error: createError } = await supabase
        .from('cogs_products')
        .insert({
          tenant_id: tenantId,
          square_item_id: estimate.square_product_id as string,
          name: estimate.product_name as string,
          is_active: true,
        })
        .select('id')
        .single()

      if (createError || !newProduct) {
        return NextResponse.json(
          { error: `Failed to create cogs_products entry: ${createError?.message}` },
          { status: 500 }
        )
      }

      cogsProductId = newProduct.id as string
    }

    // Insert cogs_product_recipes row
    const now = new Date().toISOString()
    const { data: recipe, error: recipeError } = await supabase
      .from('cogs_product_recipes')
      .insert({
        tenant_id: tenantId,
        product_id: cogsProductId,
        version: 1,
        effective_from: now,
        yield_qty: 1,
        yield_unit: 'each',
        notes: `AI-estimated recipe — approved via exception queue. Model: ${estimate.ai_model ?? 'openai/gpt-4o'}`,
      })
      .select('id')
      .single()

    if (recipeError || !recipe) {
      return NextResponse.json(
        { error: `Failed to create recipe: ${recipeError?.message}` },
        { status: 500 }
      )
    }

    const recipeId = recipe.id as string

    // Insert cogs_product_recipe_lines
    const recipeLines = ingredientsToUse.map(ing => ({
      recipe_id: recipeId,
      inventory_item_id: ing.inventory_item_id,
      qty: ing.quantity,
      unit: ing.unit,
      loss_pct: ing.loss_pct ?? 0,
    }))

    const { error: linesError } = await supabase
      .from('cogs_product_recipe_lines')
      .insert(recipeLines)

    if (linesError) {
      // Rollback recipe (best-effort)
      await supabase.from('cogs_product_recipes').delete().eq('id', recipeId)
      return NextResponse.json(
        { error: `Failed to create recipe lines: ${linesError.message}` },
        { status: 500 }
      )
    }

    // Mark estimate as approved
    const { error: updateError } = await supabase
      .from('ai_recipe_estimates')
      .update({
        review_status: 'approved',
        reviewed_at: now,
        promoted_recipe_id: recipeId,
        approved_ingredients: approvedIngredients
          ? ingredientsToUse
          : null,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (updateError) {
      console.warn('[approve] Failed to update estimate status:', updateError.message)
      // Non-fatal — recipe was created successfully
    }

    return NextResponse.json({
      success: true,
      promoted_recipe_id: recipeId,
    })
  } catch (err) {
    console.error('[cogs/recipes/approve] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
