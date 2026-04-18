/**
 * MOK-58 — Test Fixture: Inventory items
 *
 * Aligned with the staging seed data (20260328213954_seed_inventory_items.sql).
 *
 * Edge cases covered:
 *   - multiSupplierSquareId: same square_item_id referenced by two suppliers (MOK-63 fix)
 *   - noSquareId: supply items that legitimately have no Square ID (MOK-65 fix)
 */

import type { SupplierKey } from './suppliers'

export type ItemType = 'ingredient' | 'prepackaged' | 'supply'

export interface InventoryItemFixture {
  id: string           // stable test ID (used in PO line items)
  supplierKey: SupplierKey
  itemName: string
  sku: string
  unitCost: number
  unitType: string
  packSize: number
  itemType: ItemType
  /** Square catalog item ID — null for supply items without Square presence (MOK-65) */
  squareItemId: string | null
  /** When two suppliers share the same Square ID (MOK-63 scenario) */
  sharedSquareScenario?: boolean
}

// ── Bluepoint Bakery ─────────────────────────────────────────────────────────

export const BLUEPOINT_ITEMS: InventoryItemFixture[] = [
  {
    id: 'inv-bp-001',
    supplierKey: 'bluepoint',
    itemName: 'Sourdough Bread',
    sku: 'BP-SOURDOUGH',
    unitCost: 12.50,
    unitType: 'loaf',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-BREAD-001',
  },
  {
    id: 'inv-bp-002',
    supplierKey: 'bluepoint',
    itemName: 'Croissants',
    sku: 'BP-CROISSANT-DZ',
    unitCost: 18.00,
    unitType: 'dozen',
    packSize: 12,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-CROISSANT-001',
  },
  {
    id: 'inv-bp-003',
    supplierKey: 'bluepoint',
    itemName: 'Bagels',
    sku: 'BP-BAGEL-DZ',
    unitCost: 15.00,
    unitType: 'dozen',
    packSize: 12,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-BAGEL-001',
  },
  {
    id: 'inv-bp-004',
    supplierKey: 'bluepoint',
    itemName: 'Danish Pastries',
    sku: 'BP-DANISH-DZ',
    unitCost: 16.00,
    unitType: 'dozen',
    packSize: 12,
    itemType: 'prepackaged',
    squareItemId: 'SQ-ITEM-DANISH-001',
  },
  {
    id: 'inv-bp-005',
    supplierKey: 'bluepoint',
    itemName: 'Baguettes',
    sku: 'BP-BAGUETTE',
    unitCost: 8.50,
    unitType: 'loaf',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-BAGUETTE-001',
  },
]

// ── Walmart Business ─────────────────────────────────────────────────────────

export const WALMART_ITEMS: InventoryItemFixture[] = [
  {
    id: 'inv-wm-001',
    supplierKey: 'walmart',
    itemName: 'Coffee Beans - Dark Roast',
    sku: 'WM-COFFEE-DARK',
    unitCost: 8.99,
    unitType: 'lb',
    packSize: 1,
    itemType: 'ingredient',
    // MOK-63 edge case: Walmart also sells coffee beans under the same Square catalog item
    squareItemId: 'SQ-ITEM-COFFEE-001',
    sharedSquareScenario: true,
  },
  {
    id: 'inv-wm-002',
    supplierKey: 'walmart',
    itemName: 'Paper Cups - 12oz',
    sku: 'WM-CUPS-12OZ',
    unitCost: 0.08,
    unitType: 'each',
    packSize: 100,
    itemType: 'supply',
    squareItemId: null, // supply item — no Square ID (MOK-65)
  },
  {
    id: 'inv-wm-003',
    supplierKey: 'walmart',
    itemName: 'Napkins',
    sku: 'WM-NAPKINS',
    unitCost: 0.02,
    unitType: 'each',
    packSize: 500,
    itemType: 'supply',
    squareItemId: null, // supply item — no Square ID (MOK-65)
  },
  {
    id: 'inv-wm-004',
    supplierKey: 'walmart',
    itemName: 'Stirrer Straws',
    sku: 'WM-STRAWS-500',
    unitCost: 0.01,
    unitType: 'each',
    packSize: 500,
    itemType: 'supply',
    squareItemId: null, // supply item — no Square ID (MOK-65)
  },
]

// ── Gold Seal Distributors ───────────────────────────────────────────────────

export const GOLDSEAL_ITEMS: InventoryItemFixture[] = [
  {
    id: 'inv-gs-001',
    supplierKey: 'goldseal',
    itemName: 'Whole Milk',
    sku: 'GS-MILK-GAL',
    unitCost: 3.50,
    unitType: 'gallon',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-MILK-001',
  },
  {
    id: 'inv-gs-002',
    supplierKey: 'goldseal',
    itemName: 'Butter',
    sku: 'GS-BUTTER-LB',
    unitCost: 4.25,
    unitType: 'lb',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-BUTTER-001',
  },
  {
    id: 'inv-gs-003',
    supplierKey: 'goldseal',
    itemName: 'Eggs',
    sku: 'GS-EGGS-DZ',
    unitCost: 2.99,
    unitType: 'dozen',
    packSize: 12,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-EGGS-001',
  },
  {
    id: 'inv-gs-004',
    supplierKey: 'goldseal',
    itemName: 'Sugar',
    sku: 'GS-SUGAR-LB',
    unitCost: 1.50,
    unitType: 'lb',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-SUGAR-001',
  },
  {
    id: 'inv-gs-005',
    supplierKey: 'goldseal',
    itemName: 'All-Purpose Flour',
    sku: 'GS-FLOUR-LB',
    unitCost: 0.75,
    unitType: 'lb',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-FLOUR-001',
  },
  {
    id: 'inv-gs-006',
    supplierKey: 'goldseal',
    itemName: 'Heavy Cream',
    sku: 'GS-CREAM-PT',
    unitCost: 2.80,
    unitType: 'pint',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-CREAM-001',
  },
]

// ── Sam's Club ───────────────────────────────────────────────────────────────

export const SAMCLUB_ITEMS: InventoryItemFixture[] = [
  {
    id: 'inv-sc-001',
    supplierKey: 'samclub',
    itemName: 'Bulk Coffee Beans',
    sku: 'SC-COFFEE-BULK',
    unitCost: 7.50,
    unitType: 'lb',
    packSize: 1,
    itemType: 'ingredient',
    // MOK-63 edge case: Sam's Club also sells coffee under same Square catalog item as Walmart
    squareItemId: 'SQ-ITEM-COFFEE-001',
    sharedSquareScenario: true,
  },
  {
    id: 'inv-sc-002',
    supplierKey: 'samclub',
    itemName: 'Bulk Sugar',
    sku: 'SC-SUGAR-BULK',
    unitCost: 0.60,
    unitType: 'lb',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-SUGAR-001',
  },
  {
    id: 'inv-sc-003',
    supplierKey: 'samclub',
    itemName: 'Oat Milk',
    sku: 'SC-OATMILK-QT',
    unitCost: 4.50,
    unitType: 'quart',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-OATMILK-001',
  },
  {
    id: 'inv-sc-004',
    supplierKey: 'samclub',
    itemName: 'Plastic Lids - 16oz',
    sku: 'SC-LIDS-16OZ',
    unitCost: 0.06,
    unitType: 'each',
    packSize: 200,
    itemType: 'supply',
    squareItemId: null, // supply item — no Square ID (MOK-65)
  },
]

// ── Odeko ────────────────────────────────────────────────────────────────────

export const ODEKO_ITEMS: InventoryItemFixture[] = [
  {
    id: 'inv-od-001',
    supplierKey: 'odeko',
    itemName: 'Cold Brew Concentrate',
    sku: 'OD-COLDBREW-32OZ',
    unitCost: 12.00,
    unitType: 'bottle',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-COLDBREW-001',
  },
  {
    id: 'inv-od-002',
    supplierKey: 'odeko',
    itemName: 'Vanilla Syrup',
    sku: 'OD-VANILLA-750ML',
    unitCost: 8.50,
    unitType: 'bottle',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-VANILLA-001',
  },
  {
    id: 'inv-od-003',
    supplierKey: 'odeko',
    itemName: 'Caramel Sauce',
    sku: 'OD-CARAMEL-750ML',
    unitCost: 9.00,
    unitType: 'bottle',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-CARAMEL-001',
  },
  {
    id: 'inv-od-004',
    supplierKey: 'odeko',
    itemName: 'Matcha Powder',
    sku: 'OD-MATCHA-100G',
    unitCost: 14.50,
    unitType: 'bag',
    packSize: 1,
    itemType: 'ingredient',
    squareItemId: 'SQ-ITEM-MATCHA-001',
  },
  {
    id: 'inv-od-005',
    supplierKey: 'odeko',
    itemName: 'Biodegradable Cups - 12oz',
    sku: 'OD-CUPS-BIO-12OZ',
    unitCost: 0.15,
    unitType: 'each',
    packSize: 50,
    itemType: 'supply',
    squareItemId: null, // supply item — no Square ID (MOK-65)
  },
]

// ── All items ────────────────────────────────────────────────────────────────

export const ALL_INVENTORY_ITEMS: InventoryItemFixture[] = [
  ...BLUEPOINT_ITEMS,
  ...WALMART_ITEMS,
  ...GOLDSEAL_ITEMS,
  ...SAMCLUB_ITEMS,
  ...ODEKO_ITEMS,
]

/** Items with no Square ID — MOK-65 coverage */
export const ITEMS_WITHOUT_SQUARE_ID = ALL_INVENTORY_ITEMS.filter(i => i.squareItemId === null)

/** Multi-supplier same-Square-ID items — MOK-63 coverage */
export const MULTI_SUPPLIER_ITEMS = ALL_INVENTORY_ITEMS.filter(i => i.sharedSquareScenario === true)
