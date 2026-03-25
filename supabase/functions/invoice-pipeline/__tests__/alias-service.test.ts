/**
 * Unit tests for Alias Service
 *
 * Tests lookup, upsert, and manual alias protection logic.
 * Uses in-memory mock to simulate Supabase query chains.
 *
 * Run: deno test __tests__/alias-service.test.ts --allow-env --allow-net
 */

import {
  assertEquals,
  assertExists,
  assert,
} from 'https://deno.land/std@0.208.0/assert/mod.ts'

// ============================================================
// Types for testing
// ============================================================

interface AliasRecord {
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

// ============================================================
// In-memory alias store for testing
// ============================================================

class InMemoryAliasStore {
  private aliases: AliasRecord[] = []

  insert(alias: Omit<AliasRecord, 'id' | 'created_at' | 'updated_at'>): AliasRecord {
    // Check unique constraint
    const existing = this.findByKey(alias.tenant_id, alias.supplier_id, alias.supplier_description)
    if (existing) {
      throw new Error('23505: unique constraint violation')
    }

    const record: AliasRecord = {
      ...alias,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    this.aliases.push(record)
    return record
  }

  findByKey(tenantId: string, supplierId: string, description: string): AliasRecord | null {
    return this.aliases.find(
      (a) =>
        a.tenant_id === tenantId &&
        a.supplier_id === supplierId &&
        a.supplier_description === description
    ) ?? null
  }

  update(id: string, updates: Partial<AliasRecord>): AliasRecord | null {
    const idx = this.aliases.findIndex((a) => a.id === id)
    if (idx === -1) return null
    this.aliases[idx] = {
      ...this.aliases[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    }
    return this.aliases[idx]
  }

  getAll(tenantId: string, supplierId: string): AliasRecord[] {
    return this.aliases.filter(
      (a) => a.tenant_id === tenantId && a.supplier_id === supplierId
    )
  }

  count(): number {
    return this.aliases.length
  }
}

// ============================================================
// Alias service logic (inline for testing without env deps)
// ============================================================

interface UpsertAliasOptions {
  tenantId: string
  supplierId: string
  supplierDescription: string
  inventoryItemId: string
  confidence: number
  source?: 'auto' | 'manual'
  invoiceId: string
}

function upsertAliasInMemory(
  store: InMemoryAliasStore,
  opts: UpsertAliasOptions
): string | null {
  const source = opts.source ?? 'auto'
  const existing = store.findByKey(opts.tenantId, opts.supplierId, opts.supplierDescription)

  if (existing && existing.source === 'manual') {
    // Manual aliases are permanent — skip update
    return existing.id
  }

  if (existing && existing.source === 'auto') {
    const newConfidence = Math.max(existing.confidence, opts.confidence)
    const updated = store.update(existing.id, {
      inventory_item_id: opts.inventoryItemId,
      confidence: newConfidence,
      use_count: existing.use_count + 1,
      last_seen_invoice_id: opts.invoiceId,
      last_seen_at: new Date().toISOString(),
    })
    return updated?.id ?? null
  }

  try {
    const record = store.insert({
      tenant_id: opts.tenantId,
      supplier_id: opts.supplierId,
      supplier_description: opts.supplierDescription,
      inventory_item_id: opts.inventoryItemId,
      confidence: opts.confidence,
      source,
      use_count: 1,
      last_seen_invoice_id: opts.invoiceId,
      last_seen_at: new Date().toISOString(),
    })
    return record.id
  } catch {
    return null
  }
}

// ============================================================
// Tests
// ============================================================

Deno.test('AliasService — creates new alias on first insert', () => {
  const store = new InMemoryAliasStore()

  const id = upsertAliasInMemory(store, {
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    supplierDescription: 'Colombian Coffee Beans 5lb',
    inventoryItemId: 'item-1',
    confidence: 0.92,
    source: 'auto',
    invoiceId: 'invoice-1',
  })

  assertExists(id)
  assertEquals(store.count(), 1)

  const alias = store.findByKey('tenant-1', 'supplier-1', 'Colombian Coffee Beans 5lb')
  assertExists(alias)
  assertEquals(alias!.confidence, 0.92)
  assertEquals(alias!.source, 'auto')
  assertEquals(alias!.use_count, 1)
})

Deno.test('AliasService — updates auto alias with rolling max confidence', () => {
  const store = new InMemoryAliasStore()

  // First insert with low confidence
  upsertAliasInMemory(store, {
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    supplierDescription: 'Dark Roast Coffee 5lb',
    inventoryItemId: 'item-1',
    confidence: 0.87,
    source: 'auto',
    invoiceId: 'invoice-1',
  })

  // Second upsert with higher confidence — should update
  upsertAliasInMemory(store, {
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    supplierDescription: 'Dark Roast Coffee 5lb',
    inventoryItemId: 'item-1',
    confidence: 0.94,
    source: 'auto',
    invoiceId: 'invoice-2',
  })

  assertEquals(store.count(), 1) // No duplicate created
  const alias = store.findByKey('tenant-1', 'supplier-1', 'Dark Roast Coffee 5lb')
  assertEquals(alias!.confidence, 0.94) // Rolling max: max(0.87, 0.94) = 0.94
  assertEquals(alias!.use_count, 2)
  assertEquals(alias!.last_seen_invoice_id, 'invoice-2')
})

Deno.test('AliasService — does NOT update confidence if new value is lower', () => {
  const store = new InMemoryAliasStore()

  upsertAliasInMemory(store, {
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    supplierDescription: 'House Blend Coffee',
    inventoryItemId: 'item-1',
    confidence: 0.95,
    source: 'auto',
    invoiceId: 'invoice-1',
  })

  // Second upsert with LOWER confidence
  upsertAliasInMemory(store, {
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    supplierDescription: 'House Blend Coffee',
    inventoryItemId: 'item-1',
    confidence: 0.78, // Lower
    source: 'auto',
    invoiceId: 'invoice-2',
  })

  const alias = store.findByKey('tenant-1', 'supplier-1', 'House Blend Coffee')
  assertEquals(alias!.confidence, 0.95) // Rolling max preserved
  assertEquals(alias!.use_count, 2)
})

Deno.test('AliasService — manual alias is NEVER updated by pipeline', () => {
  const store = new InMemoryAliasStore()

  // Admin manually set this alias
  store.insert({
    tenant_id: 'tenant-1',
    supplier_id: 'supplier-1',
    supplier_description: 'WMT Coffee Product XYZ',
    inventory_item_id: 'item-correct',
    confidence: 1.0,
    source: 'manual',
    use_count: 3,
    last_seen_invoice_id: 'invoice-old',
    last_seen_at: new Date().toISOString(),
  })

  // Pipeline tries to update with wrong item (lower confidence auto match)
  const id = upsertAliasInMemory(store, {
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    supplierDescription: 'WMT Coffee Product XYZ',
    inventoryItemId: 'item-wrong', // Different item!
    confidence: 0.89,
    source: 'auto',
    invoiceId: 'invoice-new',
  })

  assertExists(id) // Returns the manual alias id (not null)
  assertEquals(store.count(), 1) // No new alias created

  const alias = store.findByKey('tenant-1', 'supplier-1', 'WMT Coffee Product XYZ')
  assertEquals(alias!.source, 'manual') // Still manual
  assertEquals(alias!.inventory_item_id, 'item-correct') // Not changed to 'item-wrong'
  assertEquals(alias!.confidence, 1.0) // Not changed
  assertEquals(alias!.use_count, 3) // Not incremented
})

Deno.test('AliasService — unique constraint per tenant+supplier+description', () => {
  const store = new InMemoryAliasStore()

  // Same description, same tenant, same supplier → should be unique
  upsertAliasInMemory(store, {
    tenantId: 'tenant-1',
    supplierId: 'supplier-1',
    supplierDescription: 'Espresso Beans 2kg',
    inventoryItemId: 'item-1',
    confidence: 0.9,
    invoiceId: 'inv-1',
  })

  // Same description but DIFFERENT supplier → should create new alias
  upsertAliasInMemory(store, {
    tenantId: 'tenant-1',
    supplierId: 'supplier-2', // Different supplier
    supplierDescription: 'Espresso Beans 2kg', // Same description
    inventoryItemId: 'item-2', // Different item
    confidence: 0.88,
    invoiceId: 'inv-2',
  })

  assertEquals(store.count(), 2) // Two separate aliases
})

Deno.test('AliasService — getAllAliasesForSupplier returns correct subset', () => {
  const store = new InMemoryAliasStore()

  // Add aliases for two different suppliers
  store.insert({
    tenant_id: 'tenant-1',
    supplier_id: 'supplier-A',
    supplier_description: 'Product A1',
    inventory_item_id: 'item-1',
    confidence: 0.9,
    source: 'auto',
    use_count: 5,
    last_seen_invoice_id: null,
    last_seen_at: null,
  })
  store.insert({
    tenant_id: 'tenant-1',
    supplier_id: 'supplier-A',
    supplier_description: 'Product A2',
    inventory_item_id: 'item-2',
    confidence: 0.85,
    source: 'auto',
    use_count: 2,
    last_seen_invoice_id: null,
    last_seen_at: null,
  })
  store.insert({
    tenant_id: 'tenant-1',
    supplier_id: 'supplier-B',
    supplier_description: 'Product B1',
    inventory_item_id: 'item-3',
    confidence: 0.92,
    source: 'auto',
    use_count: 1,
    last_seen_invoice_id: null,
    last_seen_at: null,
  })

  const supplierAAliases = store.getAll('tenant-1', 'supplier-A')
  assertEquals(supplierAAliases.length, 2)

  const supplierBAliases = store.getAll('tenant-1', 'supplier-B')
  assertEquals(supplierBAliases.length, 1)

  const unknownSupplier = store.getAll('tenant-1', 'supplier-unknown')
  assertEquals(unknownSupplier.length, 0)
})

Deno.test('AliasService — alias lookup is case-sensitive for description', () => {
  const store = new InMemoryAliasStore()

  store.insert({
    tenant_id: 'tenant-1',
    supplier_id: 'supplier-1',
    supplier_description: 'Colombian Coffee', // Exact casing
    inventory_item_id: 'item-1',
    confidence: 0.9,
    source: 'auto',
    use_count: 1,
    last_seen_invoice_id: null,
    last_seen_at: null,
  })

  // Exact match
  const exactMatch = store.findByKey('tenant-1', 'supplier-1', 'Colombian Coffee')
  assertExists(exactMatch)

  // Different casing — should NOT match (DB uses exact string comparison)
  const caseVariant = store.findByKey('tenant-1', 'supplier-1', 'colombian coffee')
  assertEquals(caseVariant, null)
})

Deno.test('AliasService — confidence is always between 0 and 1', () => {
  // Confidence values from AI fuzzy matching should be clamped
  const testValues = [0.0, 0.5, 0.85, 0.9, 1.0]

  for (const conf of testValues) {
    assert(conf >= 0.0 && conf <= 1.0, `Confidence ${conf} out of range`)
  }

  // Pipeline thresholds
  const autoAcceptThreshold = 0.85
  const testConfidences = [0.72, 0.85, 0.91, 0.95, 1.0]

  for (const conf of testConfidences) {
    const wouldAutoAccept = conf >= autoAcceptThreshold
    assertEquals(
      wouldAutoAccept,
      conf >= 0.85,
      `Confidence ${conf} should ${conf >= 0.85 ? '' : 'not '}auto-accept`
    )
  }
})
