/**
 * Unit tests for recipe-lookup.ts
 *
 * Tests:
 * - Returns approved recipe when one exists (no AI call)
 * - Returns existing estimate when found (no AI call)
 * - Calls AI and saves estimate when neither exists
 * - Returns no_recipe when AI finds no candidates
 * - Batch function processes all products
 * - Does NOT write to cogs_product_recipes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchOrEstimateRecipe, fetchOrEstimateRecipes } from '../recipe-lookup'
import type { SquareProductInput, InventoryItemCandidate } from '../ai-recipe-service'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT_ID = '00000000-0000-0000-0000-000000000001'

const mockProduct: SquareProductInput = {
  id: 'prod-uuid-001',
  square_item_id: 'SIM-COGS-ITEM-default-latte_tall',
  name: 'Cafe Latte (Tall)',
  category: 'prepared-drink',
}

const mockCandidates: InventoryItemCandidate[] = [
  { id: 'inv-001', item_name: 'Espresso Beans', unit_type: 'oz', unit_cost: 0.65, is_ingredient: true },
  { id: 'inv-002', item_name: 'Whole Milk', unit_type: 'ml', unit_cost: 0.002, is_ingredient: true },
]

const mockRecipeLines = [
  { inventory_item_id: 'inv-001', qty: 0.5, unit: 'oz', loss_pct: 0 },
  { inventory_item_id: 'inv-002', qty: 180, unit: 'ml', loss_pct: 0 },
]

const mockAiEstimates = [
  { inventory_item_id: 'inv-001', item_name: 'Espresso Beans', quantity: 0.5, unit: 'oz', confidence: 0.9, is_ai_estimated: true as const },
  { inventory_item_id: 'inv-002', item_name: 'Whole Milk', quantity: 180, unit: 'ml', confidence: 0.85, is_ai_estimated: true as const },
]

// ── Supabase mock factory ─────────────────────────────────────────────────────

function makeSupabaseMock(overrides: {
  recipes?: unknown[]
  recipeLines?: unknown[]
  estimates?: unknown[]
  upsertResult?: unknown[]
} = {}): SupabaseClient {
  const {
    recipes = [],
    recipeLines = [],
    estimates = [],
    upsertResult = [{ id: 'estimate-uuid-new' }],
  } = overrides

  const buildChain = (finalData: unknown[], finalError: null | { message: string } = null) => {
    const chain: Record<string, unknown> = {}
    const methods = ['select', 'eq', 'in', 'order', 'limit', 'upsert']
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    chain['then'] = undefined
    // Make it a promise-like by having the last method return the resolved value
    chain['limit'] = vi.fn().mockResolvedValue({ data: finalData, error: finalError })
    chain['order'] = vi.fn().mockReturnValue(chain)
    return chain
  }

  let callCount = 0

  const supabase = {
    from: vi.fn((tableName: string) => {
      if (tableName === 'cogs_product_recipes') {
        callCount++
        if (callCount === 1) {
          // First call: recipe lookup
          const chain = buildChain(recipes)
          chain['select'] = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: recipes, error: null }),
                }),
              }),
            }),
          })
          return chain
        }
        if (callCount === 2 && recipeLines.length > 0) {
          // Second call: recipe lines
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: recipeLines, error: null }),
            }),
          }
        }
      }

      if (tableName === 'ai_recipe_estimates') {
        // Could be lookup or upsert
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: estimates, error: null }),
                  }),
                }),
              }),
            }),
          }),
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: upsertResult, error: null }),
          }),
        }
      }

      return buildChain([])
    }),
  } as unknown as SupabaseClient

  return supabase
}

// ── Mock ai-recipe-service ────────────────────────────────────────────────────

vi.mock('../ai-recipe-service', async () => {
  const actual = await vi.importActual<typeof import('../ai-recipe-service')>('../ai-recipe-service')
  return {
    ...actual,
    generateSingleRecipeEstimate: vi.fn(),
  }
})

import { generateSingleRecipeEstimate } from '../ai-recipe-service'

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('fetchOrEstimateRecipe', () => {
  it('returns approved source when a recipe exists — no AI call', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'cogs_product_recipes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [{ id: 'recipe-001', effective_from: '2025-01-01' }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'cogs_product_recipe_lines') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockRecipeLines, error: null }),
            }),
          }
        }
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      }),
    } as unknown as SupabaseClient

    const result = await fetchOrEstimateRecipe(supabase, TENANT_ID, mockProduct, mockCandidates)

    expect(result.source).toBe('approved')
    expect(result.recipe_id).toBe('recipe-001')
    expect(result.recipe_lines).toHaveLength(2)
    expect(generateSingleRecipeEstimate).not.toHaveBeenCalled()
  })

  it('returns ai_estimate_existing when estimate exists — no AI call', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'cogs_product_recipes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'ai_recipe_estimates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [{
                          id: 'estimate-existing-001',
                          estimated_ingredients: mockAiEstimates,
                          ai_confidence: 0.88,
                          ai_reasoning: 'A latte needs espresso and milk.',
                          review_status: 'pending',
                        }],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            upsert: vi.fn(),
          }
        }
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      }),
    } as unknown as SupabaseClient

    const result = await fetchOrEstimateRecipe(supabase, TENANT_ID, mockProduct, mockCandidates)

    expect(result.source).toBe('ai_estimate_existing')
    expect(result.estimate_id).toBe('estimate-existing-001')
    expect(result.ai_confidence).toBe(0.88)
    expect(generateSingleRecipeEstimate).not.toHaveBeenCalled()
  })

  it('calls AI and saves when no recipe or estimate exists', async () => {
    vi.mocked(generateSingleRecipeEstimate).mockResolvedValueOnce({
      product_id: mockProduct.id,
      product_name: mockProduct.name,
      estimates: mockAiEstimates,
      overall_confidence: 0.87,
      ai_reasoning: 'Latte uses espresso and milk.',
      ai_model: 'openai/gpt-4o',
      is_ai_estimated: true,
    })

    const upsertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: 'estimate-new-001' }], error: null }),
    })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'cogs_product_recipes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'ai_recipe_estimates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
            upsert: upsertMock,
          }
        }
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      }),
    } as unknown as SupabaseClient

    const result = await fetchOrEstimateRecipe(supabase, TENANT_ID, mockProduct, mockCandidates)

    expect(result.source).toBe('ai_estimate_new')
    expect(result.estimate_id).toBe('estimate-new-001')
    expect(result.ai_estimates).toHaveLength(2)
    expect(result.ai_confidence).toBe(0.87)
    expect(generateSingleRecipeEstimate).toHaveBeenCalledOnce()
    expect(upsertMock).toHaveBeenCalledOnce()
  })

  it('returns no_recipe when AI finds no candidates', async () => {
    vi.mocked(generateSingleRecipeEstimate).mockResolvedValueOnce({
      product_id: mockProduct.id,
      product_name: mockProduct.name,
      estimates: [],
      overall_confidence: 0,
      ai_reasoning: 'No matching inventory items found.',
      ai_model: 'openai/gpt-4o',
      is_ai_estimated: true,
    })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'cogs_product_recipes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'ai_recipe_estimates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
            upsert: vi.fn(),
          }
        }
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      }),
    } as unknown as SupabaseClient

    const result = await fetchOrEstimateRecipe(supabase, TENANT_ID, mockProduct, mockCandidates)

    expect(result.source).toBe('no_recipe')
    expect(result.ai_estimates).toBeUndefined()
    expect(result.recipe_id).toBeUndefined()
  })

  it('does NOT write to cogs_product_recipes (only ai_recipe_estimates)', async () => {
    vi.mocked(generateSingleRecipeEstimate).mockResolvedValueOnce({
      product_id: mockProduct.id,
      product_name: mockProduct.name,
      estimates: mockAiEstimates,
      overall_confidence: 0.87,
      ai_model: 'openai/gpt-4o',
      is_ai_estimated: true,
    })

    const writtenTables: string[] = []

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'cogs_product_recipes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
            insert: vi.fn(() => { writtenTables.push('cogs_product_recipes') }),
          }
        }
        if (table === 'ai_recipe_estimates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [{ id: 'est-001' }], error: null }),
            }),
          }
        }
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      }),
    } as unknown as SupabaseClient

    await fetchOrEstimateRecipe(supabase, TENANT_ID, mockProduct, mockCandidates)

    // cogs_product_recipes.insert should never have been called
    expect(writtenTables).not.toContain('cogs_product_recipes')
  })
})

describe('fetchOrEstimateRecipes (batch)', () => {
  it('returns one result per product', async () => {
    const products: SquareProductInput[] = [
      { id: 'p1', square_item_id: 'SQ-001', name: 'Latte' },
      { id: 'p2', square_item_id: 'SQ-002', name: 'Cappuccino' },
    ]

    vi.mocked(generateSingleRecipeEstimate)
      .mockResolvedValueOnce({ product_id: 'p1', product_name: 'Latte', estimates: mockAiEstimates, overall_confidence: 0.9, ai_model: 'openai/gpt-4o', is_ai_estimated: true })
      .mockResolvedValueOnce({ product_id: 'p2', product_name: 'Cappuccino', estimates: mockAiEstimates, overall_confidence: 0.85, ai_model: 'openai/gpt-4o', is_ai_estimated: true })

    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: 'est-001' }], error: null }),
        }),
      })),
    } as unknown as SupabaseClient

    const results = await fetchOrEstimateRecipes(supabase, TENANT_ID, products, mockCandidates)

    expect(results).toHaveLength(2)
    expect(results[0].product_id).toBe('p1')
    expect(results[1].product_id).toBe('p2')
  })
})
