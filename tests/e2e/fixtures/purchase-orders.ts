/**
 * E2E Test Fixtures — Purchase Orders
 *
 * Seed data for invoice pipeline E2E tests.
 * These reference POs that should exist in the test DB (or be created by test setup).
 */

export interface TestPurchaseOrder {
  id: string
  supplier_name: string
  po_number: string
  expected_total: number
  items: TestPOItem[]
}

export interface TestPOItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

/**
 * Bluepoint Brewing — matches the happy-path PDF fixture
 */
export const bluepointPO: TestPurchaseOrder = {
  id: 'po-bluepoint-001',
  supplier_name: 'Bluepoint Brewing',
  po_number: 'BP-2026-001',
  expected_total: 450.0,
  items: [
    { description: 'Toasted Lager 1/2 BBL', quantity: 2, unit_price: 120.0, total: 240.0 },
    { description: 'Hoptical Illusion 1/6 BBL', quantity: 3, unit_price: 70.0, total: 210.0 },
  ],
}

/**
 * Odeko — used for price variance test (invoice total will differ from PO)
 */
export const odekoPO: TestPurchaseOrder = {
  id: 'po-odeko-001',
  supplier_name: 'Odeko',
  po_number: 'OD-2026-001',
  expected_total: 320.0,
  items: [
    { description: 'Oat Milk 6-pack', quantity: 4, unit_price: 45.0, total: 180.0 },
    { description: 'Cold Brew Concentrate 32oz', quantity: 7, unit_price: 20.0, total: 140.0 },
  ],
}
