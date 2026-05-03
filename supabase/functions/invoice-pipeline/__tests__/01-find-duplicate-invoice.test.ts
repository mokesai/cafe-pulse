/**
 * MOK-143 — findDuplicateInvoice short-circuits stage 1 before the UPDATE
 * that would otherwise trip the
 * `invoices_supplier_id_invoice_number_key` unique constraint.
 *
 * Pre-MOK-143 the duplicate check ran AFTER the UPDATE and only matched
 * `status='confirmed'`. A re-upload that extracted the same invoice number
 * from a row already in `pending_exceptions` / `error` / `pipeline_running`
 * tripped the constraint and stranded a zombie row in `status='error'`.
 *
 * Coverage:
 *   - matches a prior in any non-error/duplicate status
 *   - skips `error` and `duplicate` priors (those are stale/superseded)
 *   - skips the current invoice itself (idempotent on retry)
 *   - returns null when no prior exists
 *
 * Run: deno test __tests__/01-find-duplicate-invoice.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
  assertExists,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

import { findDuplicateInvoice } from '../stages/01-extract.ts'

// deno-lint-ignore no-explicit-any
type StoredInvoice = Record<string, any>

interface CapturedFilter {
  op: 'eq' | 'neq' | 'not'
  args: unknown[]
}

/**
 * Stub a supabase client with a single `from('invoices').select(...)` chain
 * that captures all filter calls and returns the first row from `rows` that
 * matches them. Mirrors the behavior we need: tenant_id eq, invoice_number
 * eq, status not-in('error','duplicate'), id neq, .maybeSingle().
 */
function makeSupabaseStub(rows: StoredInvoice[]) {
  // deno-lint-ignore no-explicit-any
  const filters: CapturedFilter[] = []

  const builder = {
    eq(col: string, val: unknown) {
      filters.push({ op: 'eq', args: [col, val] })
      return builder
    },
    neq(col: string, val: unknown) {
      filters.push({ op: 'neq', args: [col, val] })
      return builder
    },
    not(col: string, op: string, val: unknown) {
      filters.push({ op: 'not', args: [col, op, val] })
      return builder
    },
    select() {
      return builder
    },
    async maybeSingle() {
      const matched = rows.find((row) => {
        for (const f of filters) {
          if (f.op === 'eq') {
            const [col, val] = f.args as [string, unknown]
            if (row[col] !== val) return false
          } else if (f.op === 'neq') {
            const [col, val] = f.args as [string, unknown]
            if (row[col] === val) return false
          } else if (f.op === 'not') {
            const [col, op, val] = f.args as [string, string, string]
            if (op === 'in') {
              const blocked = val
                .replace(/^\(|\)$/g, '')
                .split(',')
                .map((s) => s.trim().replace(/^"|"$/g, ''))
              if (blocked.includes(row[col])) return false
            }
          }
        }
        return true
      })
      return { data: matched ?? null, error: null }
    },
  }

  const supabase = {
    from(_table: string) {
      return builder
    },
  }

  return { supabase, filters }
}

Deno.test('findDuplicateInvoice — matches a prior in pending_exceptions status', async () => {
  const { supabase } = makeSupabaseStub([
    {
      id: 'prior-1',
      tenant_id: 'tenant-A',
      invoice_number: 'INV-100',
      status: 'pending_exceptions',
      total_amount: 50,
      updated_at: '2026-04-20T00:00:00Z',
    },
  ])

  const match = await findDuplicateInvoice(supabase, 'tenant-A', 'INV-100', 'current')
  assertExists(match)
  assertEquals(match!.id, 'prior-1')
  assertEquals(match!.status, 'pending_exceptions')
})

Deno.test('findDuplicateInvoice — matches a prior in pipeline_running status', async () => {
  const { supabase } = makeSupabaseStub([
    {
      id: 'prior-2',
      tenant_id: 'tenant-A',
      invoice_number: 'INV-200',
      status: 'pipeline_running',
      total_amount: 75,
      updated_at: '2026-05-03T00:00:00Z',
    },
  ])

  const match = await findDuplicateInvoice(supabase, 'tenant-A', 'INV-200', 'current')
  assertExists(match)
  assertEquals(match!.id, 'prior-2')
})

Deno.test('findDuplicateInvoice — skips a prior in error status (stale, supersedable)', async () => {
  const { supabase } = makeSupabaseStub([
    {
      id: 'prior-err',
      tenant_id: 'tenant-A',
      invoice_number: 'INV-300',
      status: 'error',
      total_amount: 0,
      updated_at: '2026-04-30T00:00:00Z',
    },
  ])

  const match = await findDuplicateInvoice(supabase, 'tenant-A', 'INV-300', 'current')
  assertEquals(match, null)
})

Deno.test('findDuplicateInvoice — skips a prior in duplicate status (already marked duplicate)', async () => {
  const { supabase } = makeSupabaseStub([
    {
      id: 'prior-dup',
      tenant_id: 'tenant-A',
      invoice_number: 'INV-400',
      status: 'duplicate',
      total_amount: 0,
      updated_at: '2026-04-30T00:00:00Z',
    },
  ])

  const match = await findDuplicateInvoice(supabase, 'tenant-A', 'INV-400', 'current')
  assertEquals(match, null)
})

Deno.test('findDuplicateInvoice — skips the invoice currently being processed (no self-match)', async () => {
  const { supabase } = makeSupabaseStub([
    {
      id: 'self',
      tenant_id: 'tenant-A',
      invoice_number: 'INV-500',
      status: 'pipeline_running',
      total_amount: 100,
      updated_at: '2026-05-03T00:00:00Z',
    },
  ])

  const match = await findDuplicateInvoice(supabase, 'tenant-A', 'INV-500', 'self')
  assertEquals(match, null)
})

Deno.test('findDuplicateInvoice — returns null when no prior exists', async () => {
  const { supabase } = makeSupabaseStub([])
  const match = await findDuplicateInvoice(supabase, 'tenant-A', 'INV-NEVER', 'current')
  assertEquals(match, null)
})

Deno.test('findDuplicateInvoice — does not cross tenants', async () => {
  const { supabase } = makeSupabaseStub([
    {
      id: 'other-tenant',
      tenant_id: 'tenant-B',
      invoice_number: 'INV-600',
      status: 'confirmed',
      total_amount: 200,
      updated_at: '2026-05-03T00:00:00Z',
    },
  ])

  const match = await findDuplicateInvoice(supabase, 'tenant-A', 'INV-600', 'current')
  assertEquals(match, null)
})

Deno.test('findDuplicateInvoice — matches confirmed priors too (regression: pre-MOK-143 only fired here)', async () => {
  const { supabase } = makeSupabaseStub([
    {
      id: 'prior-confirmed',
      tenant_id: 'tenant-A',
      invoice_number: 'INV-700',
      status: 'confirmed',
      total_amount: 150,
      updated_at: '2026-04-15T00:00:00Z',
    },
  ])

  const match = await findDuplicateInvoice(supabase, 'tenant-A', 'INV-700', 'current')
  assertExists(match)
  assertEquals(match!.id, 'prior-confirmed')
})
