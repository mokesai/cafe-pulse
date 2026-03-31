/**
 * MOK-58 — Test Fixture: Purchase Order factories
 *
 * Creates 5 POs (one per supplier) with realistic line items.
 * Dates are within the 90-day invoice matching window.
 *
 * Edge cases covered:
 *   - Bluepoint PO + Walmart PO both contain a "coffee beans" line item referencing
 *     the same Square catalog item (MOK-63: multi-supplier same Square ID)
 *   - Walmart PO and Sam's Club PO include supply items with no Square ID (MOK-65)
 */

import type { SupplierKey } from './suppliers'
import {
  BLUEPOINT_ITEMS,
  WALMART_ITEMS,
  GOLDSEAL_ITEMS,
  SAMCLUB_ITEMS,
  ODEKO_ITEMS,
} from './inventory-items'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface POLineItem {
  inventoryItemId: string   // maps to InventoryItemFixture.id
  itemName: string
  sku: string
  quantityOrdered: number
  unitCost: number
  totalCost: number
  unitType: string
  packSize: number
  /** True when this item has no Square ID — tests MOK-65 fix */
  hasNoSquareId?: boolean
  /** True when another supplier has the same Square ID — tests MOK-63 fix */
  isMultiSupplierSquareItem?: boolean
}

export interface PurchaseOrderFixture {
  /** Stable reference key for use in test assertions */
  fixtureKey: string
  supplierKey: SupplierKey
  orderNumber: string
  /** ISO date string — within 90 days of "today" for matching window */
  orderDate: string
  expectedDeliveryDate: string
  status: 'sent' | 'confirmed' | 'received'
  lineItems: POLineItem[]
  totalAmount: number
  notes?: string
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns an ISO date string offset from today by `daysOffset` days.
 * Negative = past, positive = future.
 */
function relativeDate(daysOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  return d.toISOString().split('T')[0]
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function computeTotal(items: POLineItem[]): number {
  return parseFloat(items.reduce((sum, i) => sum + i.totalCost, 0).toFixed(2))
}

function makeLine(
  item: (typeof BLUEPOINT_ITEMS)[number],
  qty: number,
  overrideUnitCost?: number
): POLineItem {
  const unitCost = overrideUnitCost ?? item.unitCost
  return {
    inventoryItemId: item.id,
    itemName: item.itemName,
    sku: item.sku,
    quantityOrdered: qty,
    unitCost,
    totalCost: parseFloat((qty * unitCost).toFixed(2)),
    unitType: item.unitType,
    packSize: item.packSize,
    hasNoSquareId: item.squareItemId === null,
    isMultiSupplierSquareItem: item.sharedSquareScenario === true,
  }
}

// ─── PO: Bluepoint Bakery ─────────────────────────────────────────────────────

const bluepointLines: POLineItem[] = [
  makeLine(BLUEPOINT_ITEMS[0], 20),  // Sourdough Bread x20
  makeLine(BLUEPOINT_ITEMS[1], 10),  // Croissants x10 dozen
  makeLine(BLUEPOINT_ITEMS[2], 8),   // Bagels x8 dozen
  makeLine(BLUEPOINT_ITEMS[3], 5),   // Danish Pastries x5 dozen
  makeLine(BLUEPOINT_ITEMS[4], 15),  // Baguettes x15
]

export const BLUEPOINT_PO: PurchaseOrderFixture = {
  fixtureKey: 'po-bluepoint-001',
  supplierKey: 'bluepoint',
  orderNumber: 'PO-BP-001',
  orderDate: relativeDate(-14),          // 2 weeks ago
  expectedDeliveryDate: relativeDate(-7), // delivered 1 week ago
  status: 'received',
  lineItems: bluepointLines,
  totalAmount: computeTotal(bluepointLines),
  notes: 'Weekly bakery order — fresh baked goods for display case',
}

// ─── PO: Walmart Business ─────────────────────────────────────────────────────
// Includes supply items with no Square ID (MOK-65) and multi-supplier coffee item (MOK-63)

const walmartLines: POLineItem[] = [
  makeLine(WALMART_ITEMS[0], 15),  // Coffee Beans Dark Roast — shared Square ID with Sam's Club
  makeLine(WALMART_ITEMS[1], 5),   // Paper Cups 12oz — no Square ID (supply)
  makeLine(WALMART_ITEMS[2], 10),  // Napkins — no Square ID (supply)
  makeLine(WALMART_ITEMS[3], 3),   // Stirrer Straws — no Square ID (supply)
]

export const WALMART_PO: PurchaseOrderFixture = {
  fixtureKey: 'po-walmart-001',
  supplierKey: 'walmart',
  orderNumber: 'PO-WM-001',
  orderDate: relativeDate(-21),           // 3 weeks ago
  expectedDeliveryDate: relativeDate(-14), // delivered 2 weeks ago
  status: 'received',
  lineItems: walmartLines,
  totalAmount: computeTotal(walmartLines),
  notes: 'Monthly supplies order — coffee beans + disposables',
}

// ─── PO: Gold Seal Distributors ───────────────────────────────────────────────

const goldsealLines: POLineItem[] = [
  makeLine(GOLDSEAL_ITEMS[0], 30),  // Whole Milk x30 gallons
  makeLine(GOLDSEAL_ITEMS[1], 20),  // Butter x20 lb
  makeLine(GOLDSEAL_ITEMS[2], 24),  // Eggs x24 dozen
  makeLine(GOLDSEAL_ITEMS[3], 50),  // Sugar x50 lb
  makeLine(GOLDSEAL_ITEMS[4], 100), // All-Purpose Flour x100 lb
  makeLine(GOLDSEAL_ITEMS[5], 12),  // Heavy Cream x12 pints
]

export const GOLDSEAL_PO: PurchaseOrderFixture = {
  fixtureKey: 'po-goldseal-001',
  supplierKey: 'goldseal',
  orderNumber: 'PO-GS-001',
  orderDate: relativeDate(-10),           // 10 days ago
  expectedDeliveryDate: relativeDate(-5),  // delivered 5 days ago
  status: 'received',
  lineItems: goldsealLines,
  totalAmount: computeTotal(goldsealLines),
  notes: 'Bi-weekly dairy and dry goods order',
}

// ─── PO: Sam's Club ───────────────────────────────────────────────────────────
// Also includes multi-supplier coffee item (MOK-63) + supply item without Square ID

const samclubLines: POLineItem[] = [
  makeLine(SAMCLUB_ITEMS[0], 25),  // Bulk Coffee Beans — shared Square ID with Walmart
  makeLine(SAMCLUB_ITEMS[1], 75),  // Bulk Sugar x75 lb
  makeLine(SAMCLUB_ITEMS[2], 20),  // Oat Milk x20 quarts
  makeLine(SAMCLUB_ITEMS[3], 4),   // Plastic Lids — no Square ID (supply)
]

export const SAMCLUB_PO: PurchaseOrderFixture = {
  fixtureKey: 'po-samclub-001',
  supplierKey: 'samclub',
  orderNumber: 'PO-SC-001',
  orderDate: relativeDate(-30),           // 1 month ago
  expectedDeliveryDate: relativeDate(-25), // delivered 25 days ago
  status: 'confirmed',
  lineItems: samclubLines,
  totalAmount: computeTotal(samclubLines),
  notes: "Sam's Club bulk purchase — coffee beans + sugar + alt milks + lids",
}

// ─── PO: Odeko ────────────────────────────────────────────────────────────────

const odekoPriceVarianceLine = makeLine(ODEKO_ITEMS[0], 12, 11.50) // Cold Brew — slight price variance from PO
const odekoLines: POLineItem[] = [
  odekoPriceVarianceLine,                // Cold Brew x12 @ $11.50 (invoice will arrive at $12.00 — price variance test)
  makeLine(ODEKO_ITEMS[1], 6),           // Vanilla Syrup x6
  makeLine(ODEKO_ITEMS[2], 6),           // Caramel Sauce x6
  makeLine(ODEKO_ITEMS[3], 3),           // Matcha Powder x3
  makeLine(ODEKO_ITEMS[4], 10),          // Biodegradable Cups — no Square ID (supply)
]

export const ODEKO_PO: PurchaseOrderFixture = {
  fixtureKey: 'po-odeko-001',
  supplierKey: 'odeko',
  orderNumber: 'PO-OD-001',
  orderDate: relativeDate(-7),           // 1 week ago
  expectedDeliveryDate: relativeDate(-2), // delivered 2 days ago
  status: 'confirmed',
  lineItems: odekoLines,
  totalAmount: computeTotal(odekoLines),
  notes: 'Weekly Odeko specialty order — syrups + cold brew + eco cups',
}

// ─── All POs ──────────────────────────────────────────────────────────────────

export const ALL_PURCHASE_ORDERS: PurchaseOrderFixture[] = [
  BLUEPOINT_PO,
  WALMART_PO,
  GOLDSEAL_PO,
  SAMCLUB_PO,
  ODEKO_PO,
]

export const PO_BY_SUPPLIER: Record<string, PurchaseOrderFixture> = {
  bluepoint: BLUEPOINT_PO,
  walmart: WALMART_PO,
  goldseal: GOLDSEAL_PO,
  samclub: SAMCLUB_PO,
  odeko: ODEKO_PO,
}
