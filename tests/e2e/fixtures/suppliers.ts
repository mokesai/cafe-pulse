/**
 * MOK-58 — Test Fixture: Supplier definitions
 *
 * Five suppliers matching staging seed data.
 * Used by PO factories and invoice PDF generators.
 */

export type SupplierKey = 'bluepoint' | 'walmart' | 'goldseal' | 'samclub' | 'odeko'

export interface SupplierFixture {
  key: SupplierKey
  name: string
  email: string
  phone: string
  address: string
  /** Invoice header label as it appears on their PDFs */
  invoiceLabel: string
}

export const SUPPLIERS: Record<SupplierKey, SupplierFixture> = {
  bluepoint: {
    key: 'bluepoint',
    name: 'Bluepoint Bakery',
    email: 'contact@bluepointbakery.com',
    phone: '555-0001',
    address: '100 Bakery Lane, Denver, CO 80201',
    invoiceLabel: 'BLUEPOINT BAKERY',
  },
  walmart: {
    key: 'walmart',
    name: 'Walmart Business',
    email: 'orders@walmart.com',
    phone: '555-0002',
    address: '8000 E Colfax Ave, Denver, CO 80220',
    invoiceLabel: 'WALMART BUSINESS',
  },
  goldseal: {
    key: 'goldseal',
    name: 'Gold Seal Distributors',
    email: 'sales@goldseal.com',
    phone: '555-0007',
    address: '2200 Distribution Way, Denver, CO 80239',
    invoiceLabel: 'GOLD SEAL DISTRIBUTORS',
  },
  samclub: {
    key: 'samclub',
    name: "Sam's Club",
    email: 'business@samsclub.com',
    phone: '555-0003',
    address: '6600 S Yosemite St, Centennial, CO 80111',
    invoiceLabel: "SAM'S CLUB BUSINESS",
  },
  odeko: {
    key: 'odeko',
    name: 'Odeko',
    email: 'sales@odeko.com',
    phone: '555-0004',
    address: '1 Odeko Plaza, New York, NY 10001',
    invoiceLabel: 'ODEKO SUPPLY CO.',
  },
}

export const SUPPLIER_KEYS = Object.keys(SUPPLIERS) as SupplierKey[]
