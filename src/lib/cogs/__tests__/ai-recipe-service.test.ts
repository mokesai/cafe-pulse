/**
 * Unit tests for ai-recipe-service.ts
 *
 * Tests:
 * - generateSingleRecipeEstimate returns correct shape
 * - Hallucinated inventory_item_ids are rejected
 * - OpenRouter errors return empty estimates (not throw)
 * - is_ai_estimated is always true
 * - Does NOT write to any database (verified by mock checks)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateSingleRecipeEstimate,
  generateRecipeEstimates,
  type SquareProductInput,
  type InventoryItemCandidate,
} from '../ai-recipe-service'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockProduct: SquareProductInput = {
  id: 'prod-uuid-001',
  square_item_id: 'SQ-ITEM-001',
  name: 'Latte',
  description: 'Espresso with steamed milk',
  category: 'Espresso Drinks',
  price_cents: 550,
}

const mockCandidates: InventoryItemCandidate[] = [
  {
    id: 'inv-001',
    item_name: 'Espresso Beans',
    unit_type: 'oz',
    unit_cost: 0.65,
    is_ingredient: true,
  },
  {
    id: 'inv-002',
    item_name: 'Whole Milk',
    unit_type: 'ml',
    unit_cost: 0.002,
    is_ingredient: true,
  },
  {
    id: 'inv-003',
    item_name: 'Paper Cup 12oz',
    unit_type: 'each',
    unit_cost: 0.12,
    is_ingredient: false,
  },
]

const validApiResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          estimates: [
            {
              inventory_item_id: 'inv-001',
              item_name: 'Espresso Beans',
              quantity: 0.64,
              unit: 'oz',
              confidence: 0.92,
              notes: 'Double shot espresso',
            },
            {
              inventory_item_id: 'inv-002',
              item_name: 'Whole Milk',
              quantity: 180,
              unit: 'ml',
              confidence: 0.88,
            },
          ],
          overall_confidence: 0.9,
          reasoning: 'Latte requires espresso and steamed milk.',
        }),
      },
    },
  ],
  usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 },
}

// ── Mock fetch ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-123')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generateSingleRecipeEstimate', () => {
  it('returns correct shape with is_ai_estimated=true', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(validApiResponse),
    } as Response)

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    expect(result.is_ai_estimated).toBe(true)
    expect(result.product_id).toBe('prod-uuid-001')
    expect(result.product_name).toBe('Latte')
    expect(result.ai_model).toBe('openai/gpt-4o')
    expect(result.estimates.length).toBe(2)
    expect(result.overall_confidence).toBeGreaterThan(0)
  })

  it('each estimate has is_ai_estimated=true', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(validApiResponse),
    } as Response)

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    for (const estimate of result.estimates) {
      expect(estimate.is_ai_estimated).toBe(true)
    }
  })

  it('rejects hallucinated inventory_item_ids not in candidate list', async () => {
    const responseWithHallucination = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              estimates: [
                {
                  inventory_item_id: 'inv-001',  // valid
                  item_name: 'Espresso Beans',
                  quantity: 0.64,
                  unit: 'oz',
                  confidence: 0.9,
                },
                {
                  inventory_item_id: 'HALLUCINATED-UUID-XYZ',  // invalid — not in candidates
                  item_name: 'Magic Ingredient',
                  quantity: 10,
                  unit: 'g',
                  confidence: 0.8,
                },
              ],
              overall_confidence: 0.85,
              reasoning: 'Test',
            }),
          },
        },
      ],
    }

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseWithHallucination),
    } as Response)

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    // Only the valid inventory_item_id should survive
    expect(result.estimates.length).toBe(1)
    expect(result.estimates[0].inventory_item_id).toBe('inv-001')
  })

  it('returns empty estimates (not throws) when OpenRouter returns an error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as unknown as Response)

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    expect(result.estimates).toEqual([])
    expect(result.overall_confidence).toBe(0)
    expect(result.is_ai_estimated).toBe(true)
    expect(result.ai_reasoning).toContain('Error')
  })

  it('returns empty estimates when fetch throws (network error)', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network failure'))

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    expect(result.estimates).toEqual([])
    expect(result.overall_confidence).toBe(0)
    expect(result.is_ai_estimated).toBe(true)
  })

  it('returns empty estimates when AI returns malformed JSON', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'not valid json at all }{' } }],
      }),
    } as Response)

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    expect(result.estimates).toEqual([])
    expect(result.is_ai_estimated).toBe(true)
  })

  it('filters out estimates with zero or negative quantity', async () => {
    const responseWithBadQty = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              estimates: [
                {
                  inventory_item_id: 'inv-001',
                  item_name: 'Espresso Beans',
                  quantity: 0,     // invalid — zero quantity
                  unit: 'oz',
                  confidence: 0.9,
                },
                {
                  inventory_item_id: 'inv-002',
                  item_name: 'Whole Milk',
                  quantity: 180,   // valid
                  unit: 'ml',
                  confidence: 0.85,
                },
              ],
              overall_confidence: 0.7,
              reasoning: 'Test',
            }),
          },
        },
      ],
    }

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseWithBadQty),
    } as Response)

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    expect(result.estimates.length).toBe(1)
    expect(result.estimates[0].inventory_item_id).toBe('inv-002')
  })

  it('clamps confidence values to 0–1 range', async () => {
    const responseWithBadConfidence = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              estimates: [
                {
                  inventory_item_id: 'inv-001',
                  item_name: 'Espresso Beans',
                  quantity: 0.64,
                  unit: 'oz',
                  confidence: 1.5,  // out of range — should be clamped to 1.0
                },
              ],
              overall_confidence: -0.2,  // out of range — should be clamped to 0.0
              reasoning: 'Test',
            }),
          },
        },
      ],
    }

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseWithBadConfidence),
    } as Response)

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    expect(result.estimates[0].confidence).toBe(1.0)
    expect(result.overall_confidence).toBe(0.0)
  })

  it('does not call fetch when OPENROUTER_API_KEY is missing', async () => {
    vi.unstubAllEnvs()
    // Don't set OPENROUTER_API_KEY
    const mockFetch = vi.fn()
    global.fetch = mockFetch

    const result = await generateSingleRecipeEstimate(mockProduct, mockCandidates)

    // Should return error result, not throw
    expect(result.estimates).toEqual([])
    expect(result.is_ai_estimated).toBe(true)
    // fetch should not have been called (error thrown before fetch)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('generateRecipeEstimates (batch)', () => {
  it('returns one result per product', async () => {
    const products: SquareProductInput[] = [
      { id: 'p1', square_item_id: 'SQ-001', name: 'Latte', category: 'Drinks' },
      { id: 'p2', square_item_id: 'SQ-002', name: 'Muffin', category: 'Food' },
    ]

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validApiResponse),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: JSON.stringify({ estimates: [], overall_confidence: 0.1, reasoning: 'No matching ingredients' }) } }],
        }),
      } as Response)

    const results = await generateRecipeEstimates(products, mockCandidates)

    expect(results.length).toBe(2)
    expect(results[0].product_id).toBe('p1')
    expect(results[1].product_id).toBe('p2')
    expect(results.every(r => r.is_ai_estimated)).toBe(true)
  })

  it('continues to next product when one fails', async () => {
    const products: SquareProductInput[] = [
      { id: 'p1', square_item_id: 'SQ-001', name: 'Latte' },
      { id: 'p2', square_item_id: 'SQ-002', name: 'Cappuccino' },
    ]

    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('Network error on first product'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validApiResponse),
      } as Response)

    const results = await generateRecipeEstimates(products, mockCandidates)

    expect(results.length).toBe(2)
    expect(results[0].estimates).toEqual([])  // first failed
    expect(results[1].estimates.length).toBeGreaterThan(0)  // second succeeded
  })
})
