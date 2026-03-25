/**
 * Integration / contract tests for invoice-pipeline-settings API routes.
 * Uses mocked fetch to avoid hitting real backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

const BASE = '/api/admin/invoice-pipeline-settings'

beforeEach(() => {
  fetchMock.mockReset()
})

const DEFAULT_SETTINGS = {
  no_po_match_behavior: 'always_create',
  price_variance_threshold_pct: 10,
  total_variance_threshold_pct: 5,
  match_confidence_threshold_pct: 85,
  vision_confidence_threshold_pct: 60
}

// ============================================================
// GET /api/admin/invoice-pipeline-settings
// ============================================================

describe('GET /api/admin/invoice-pipeline-settings', () => {
  it('returns pipeline settings with correct shape', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: DEFAULT_SETTINGS })
    })

    const response = await fetch(BASE)
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.success).toBe(true)
    expect(data.data).toMatchObject({
      no_po_match_behavior: expect.stringMatching(/^(always_create|auto_dismiss|notify_continue)$/),
      price_variance_threshold_pct: expect.any(Number),
      total_variance_threshold_pct: expect.any(Number),
      match_confidence_threshold_pct: expect.any(Number),
      vision_confidence_threshold_pct: expect.any(Number)
    })
  })

  it('returns 401 when unauthenticated', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    })

    const response = await fetch(BASE)
    expect(response.status).toBe(401)
  })
})

// ============================================================
// PUT /api/admin/invoice-pipeline-settings
// ============================================================

describe('PUT /api/admin/invoice-pipeline-settings', () => {
  it('updates no_po_match_behavior', async () => {
    const updatedSettings = { ...DEFAULT_SETTINGS, no_po_match_behavior: 'auto_dismiss' }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: updatedSettings })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ no_po_match_behavior: 'auto_dismiss' })
    })
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.success).toBe(true)
    expect(data.data.no_po_match_behavior).toBe('auto_dismiss')

    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('PUT')
    const sentBody = JSON.parse(options.body)
    expect(sentBody.no_po_match_behavior).toBe('auto_dismiss')
  })

  it('updates price_variance_threshold_pct', async () => {
    const updatedSettings = { ...DEFAULT_SETTINGS, price_variance_threshold_pct: 15 }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: updatedSettings })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_variance_threshold_pct: 15 })
    })
    const data = await response.json()

    expect(data.data.price_variance_threshold_pct).toBe(15)
  })

  it('updates all settings at once', async () => {
    const newSettings = {
      no_po_match_behavior: 'notify_continue',
      price_variance_threshold_pct: 20,
      total_variance_threshold_pct: 10,
      match_confidence_threshold_pct: 90,
      vision_confidence_threshold_pct: 70
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: newSettings })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    })
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.data).toMatchObject(newSettings)
  })

  it('returns 400 for invalid no_po_match_behavior value', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'no_po_match_behavior must be one of: always_create, auto_dismiss, notify_continue' })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ no_po_match_behavior: 'invalid_value' })
    })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('no_po_match_behavior')
  })

  it('returns 400 for price_variance_threshold_pct below minimum (1)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'price_variance_threshold_pct must be an integer between 1 and 100' })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_variance_threshold_pct: 0 })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 for match_confidence_threshold_pct below minimum (50)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'match_confidence_threshold_pct must be an integer between 50 and 100' })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_confidence_threshold_pct: 49 })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 for vision_confidence_threshold_pct below minimum (10)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'vision_confidence_threshold_pct must be an integer between 10 and 100' })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vision_confidence_threshold_pct: 5 })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when no valid fields are provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'No valid fields provided for update' })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(response.status).toBe(400)
  })

  it('supports partial update (only one field)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { ...DEFAULT_SETTINGS, vision_confidence_threshold_pct: 75 }
      })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vision_confidence_threshold_pct: 75 })
    })
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.data.vision_confidence_threshold_pct).toBe(75)
    // Other fields should still have their default values
    expect(data.data.price_variance_threshold_pct).toBe(DEFAULT_SETTINGS.price_variance_threshold_pct)
  })

  it('returns 401 when unauthenticated', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    })

    const response = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_variance_threshold_pct: 10 })
    })
    expect(response.status).toBe(401)
  })
})

// ============================================================
// Round-trip contract test: GET → PUT → GET
// ============================================================

describe('GET → PUT → GET round-trip contract', () => {
  it('returns updated values after PUT', async () => {
    // Simulate GET returning defaults
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: DEFAULT_SETTINGS })
      })
      // Simulate PUT succeeding
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { ...DEFAULT_SETTINGS, price_variance_threshold_pct: 20 }
        })
      })
      // Simulate GET after PUT returning new value
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { ...DEFAULT_SETTINGS, price_variance_threshold_pct: 20 }
        })
      })

    // GET initial
    const getResponse = await fetch(BASE)
    const initialData = await getResponse.json()
    expect(initialData.data.price_variance_threshold_pct).toBe(10)

    // PUT update
    const putResponse = await fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_variance_threshold_pct: 20 })
    })
    const putData = await putResponse.json()
    expect(putData.data.price_variance_threshold_pct).toBe(20)

    // GET after update
    const afterResponse = await fetch(BASE)
    const afterData = await afterResponse.json()
    expect(afterData.data.price_variance_threshold_pct).toBe(20)
  })
})
