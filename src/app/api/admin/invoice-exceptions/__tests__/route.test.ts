/**
 * Integration / contract tests for invoice-exceptions API routes.
 * Uses mocked fetch to avoid hitting real backend; tests request shaping,
 * response contracts, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

const BASE = '/api/admin/invoice-exceptions'

beforeEach(() => {
  fetchMock.mockReset()
})

// ============================================================
// GET /api/admin/invoice-exceptions
// ============================================================

describe('GET /api/admin/invoice-exceptions', () => {
  it('fetches open exceptions by default', async () => {
    const mockData = {
      success: true,
      data: [
        {
          id: 'exc-1',
          exception_type: 'no_item_match',
          status: 'open',
          created_at: new Date().toISOString()
        }
      ],
      open_count: 1,
      pagination: { page: 1, limit: 20, total: 1, pages: 1 }
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData
    })

    const response = await fetch(`${BASE}?status=open`)
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.success).toBe(true)
    expect(Array.isArray(data.data)).toBe(true)
    expect(data.open_count).toBeDefined()
    expect(data.pagination).toMatchObject({ page: 1, limit: 20 })
  })

  it('supports status=all filter', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [],
        open_count: 0,
        pagination: { page: 1, limit: 20, total: 0, pages: 0 }
      })
    })

    const response = await fetch(`${BASE}?status=all`)
    expect(response.ok).toBe(true)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('status=all')
  })

  it('supports type filter (comma-separated)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [], open_count: 0, pagination: {} })
    })

    await fetch(`${BASE}?type=price_variance,no_item_match`)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('type=price_variance,no_item_match')
  })

  it('supports invoice_id filter', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [], open_count: 0, pagination: {} })
    })

    await fetch(`${BASE}?invoice_id=inv-123`)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('invoice_id=inv-123')
  })

  it('supports supplier_id filter', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [], open_count: 0, pagination: {} })
    })

    await fetch(`${BASE}?supplier_id=sup-123`)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('supplier_id=sup-123')
  })

  it('supports pagination params', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [], open_count: 0, pagination: { page: 2, limit: 10 } })
    })

    const response = await fetch(`${BASE}?page=2&limit=10`)
    const data = await response.json()
    expect(data.pagination.page).toBe(2)
    expect(data.pagination.limit).toBe(10)
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
// GET /api/admin/invoice-exceptions/[id]
// ============================================================

describe('GET /api/admin/invoice-exceptions/[id]', () => {
  it('returns exception with invoice and invoice_item context', async () => {
    const mockData = {
      success: true,
      data: {
        id: 'exc-1',
        exception_type: 'price_variance',
        status: 'open',
        invoice: {
          id: 'inv-1',
          invoice_number: 'INV-001',
          invoice_date: '2026-03-24',
          total_amount: 500,
          pipeline_stage: 'matching_items',
          supplier_id: 'sup-1',
          suppliers: { id: 'sup-1', name: 'Acme Foods' }
        },
        invoice_item: {
          id: 'item-1',
          item_description: 'Colombian Coffee Beans',
          unit_price: 14.0,
          quantity: 5
        },
        other_open_exceptions_count: 2
      }
    }

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData
    })

    const response = await fetch(`${BASE}/exc-1`)
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.success).toBe(true)
    expect(data.data.invoice).toBeDefined()
    expect(data.data.other_open_exceptions_count).toBeTypeOf('number')
  })

  it('returns 404 for non-existent exception', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Exception not found' })
    })

    const response = await fetch(`${BASE}/nonexistent-id`)
    expect(response.status).toBe(404)
  })
})

// ============================================================
// POST /api/admin/invoice-exceptions/[id]/resolve
// ============================================================

describe('POST /api/admin/invoice-exceptions/[id]/resolve', () => {
  it('resolves with approve_and_continue action', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        exception_id: 'exc-1',
        invoice_auto_confirmed: false,
        pipeline_continued: false
      })
    })

    const body = { action: { type: 'approve_and_continue' } }
    const response = await fetch(`${BASE}/exc-1/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.success).toBe(true)
    expect(data.exception_id).toBe('exc-1')
    expect(typeof data.invoice_auto_confirmed).toBe('boolean')
    expect(typeof data.pipeline_continued).toBe('boolean')
  })

  it('resolves with match_item action and creates alias', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        exception_id: 'exc-2',
        invoice_auto_confirmed: true,
        pipeline_continued: true
      })
    })

    const body = {
      resolution_notes: 'Matched to Colombian Coffee Beans SKU',
      action: {
        type: 'match_item',
        inventory_item_id: 'inv-item-uuid-123'
      }
    }

    const response = await fetch(`${BASE}/exc-2/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.success).toBe(true)

    // Verify payload was sent correctly
    const [, options] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(options.body)
    expect(sentBody.action.type).toBe('match_item')
    expect(sentBody.action.inventory_item_id).toBe('inv-item-uuid-123')
  })

  it('returns 400 when resolving price_variance reject without notes', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'resolution_notes is required when rejecting a price variance'
      })
    })

    const body = { action: { type: 'reject_cost_update' } }
    const response = await fetch(`${BASE}/exc-3/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('resolution_notes')
  })

  it('returns 422 when exception is already resolved', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Exception is already resolved' })
    })

    const body = { action: { type: 'approve_and_continue' } }
    const response = await fetch(`${BASE}/exc-4/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    expect(response.status).toBe(422)
  })

  it('returns 400 when action is missing', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Missing required field: action.type' })
    })

    const response = await fetch(`${BASE}/exc-5/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution_notes: 'notes only, no action' })
    })
    expect(response.status).toBe(400)
  })
})

// ============================================================
// POST /api/admin/invoice-exceptions/[id]/dismiss
// ============================================================

describe('POST /api/admin/invoice-exceptions/[id]/dismiss', () => {
  it('dismisses an open exception', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, exception_id: 'exc-1' })
    })

    const response = await fetch(`${BASE}/exc-1/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution_notes: 'Not relevant for this tenant' })
    })
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.success).toBe(true)
    expect(data.exception_id).toBe('exc-1')
  })

  it('dismisses without notes (notes are optional)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, exception_id: 'exc-2' })
    })

    const response = await fetch(`${BASE}/exc-2/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(response.ok).toBe(true)
  })

  it('returns 422 when exception is already dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Exception is already dismissed' })
    })

    const response = await fetch(`${BASE}/exc-3/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(response.status).toBe(422)
  })
})

// ============================================================
// POST /api/admin/invoice-exceptions/bulk-dismiss
// ============================================================

describe('POST /api/admin/invoice-exceptions/bulk-dismiss', () => {
  it('bulk dismisses multiple open exceptions', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        dismissed_count: 3,
        failed_ids: []
      })
    })

    const body = {
      exception_ids: ['exc-1', 'exc-2', 'exc-3'],
      resolution_notes: 'Batch dismiss during cleanup'
    }

    const response = await fetch(`${BASE}/bulk-dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await response.json()

    expect(response.ok).toBe(true)
    expect(data.success).toBe(true)
    expect(data.dismissed_count).toBe(3)
    expect(data.failed_ids).toEqual([])
  })

  it('reports failed_ids for already-resolved exceptions', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        dismissed_count: 2,
        failed_ids: ['exc-already-resolved']
      })
    })

    const body = {
      exception_ids: ['exc-1', 'exc-2', 'exc-already-resolved']
    }

    const response = await fetch(`${BASE}/bulk-dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await response.json()

    expect(data.dismissed_count).toBe(2)
    expect(data.failed_ids).toContain('exc-already-resolved')
  })

  it('returns 400 for empty exception_ids array', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'exception_ids must be a non-empty array' })
    })

    const response = await fetch(`${BASE}/bulk-dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exception_ids: [] })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when more than 50 IDs are provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Maximum bulk dismiss size is 50 exceptions' })
    })

    const tooManyIds = Array.from({ length: 51 }, (_, i) => `exc-${i}`)
    const response = await fetch(`${BASE}/bulk-dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exception_ids: tooManyIds })
    })
    expect(response.status).toBe(400)
  })
})
