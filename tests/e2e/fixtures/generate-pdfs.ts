/**
 * MOK-59 — Test Asset Generator: Invoice PDFs
 *
 * Generates 5 realistic invoice PDFs (one per supplier) using pdf-lib.
 * Run with: npx ts-node --project tsconfig.json tests/e2e/fixtures/generate-pdfs.ts
 *
 * Design choices:
 *   - Bluepoint: clean text layout (plain text, readable by AI extractor)
 *   - Walmart: formatted table layout (borders + columns)
 *   - Gold Seal: formatted table layout with multi-line descriptions
 *   - Sam's Club: clean text layout — bulk pricing style
 *   - Odeko: formatted table layout with price variance + supplier fees
 *
 * All PDFs include supplier fee lines (delivery/shipping/processing) to test MOK-66.
 * Odeko invoice has a price variance on Cold Brew ($12.00 vs $11.50 PO) to test
 * the price variance exception path.
 */

import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib'
import * as fs from 'fs'
import * as path from 'path'
import { SUPPLIERS, type SupplierKey } from './suppliers'
import {
  BLUEPOINT_PO,
  WALMART_PO,
  GOLDSEAL_PO,
  SAMCLUB_PO,
  ODEKO_PO,
  type PurchaseOrderFixture,
  type POLineItem,
} from './purchase-orders'

const OUTPUT_DIR = path.join(__dirname, 'pdfs')

// ─── Layout constants ─────────────────────────────────────────────────────────

const PAGE_WIDTH = 612  // US Letter
const PAGE_HEIGHT = 792
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const BLACK = rgb(0, 0, 0)
const DARK_GRAY = rgb(0.2, 0.2, 0.2)
const MID_GRAY = rgb(0.5, 0.5, 0.5)
const LIGHT_GRAY = rgb(0.85, 0.85, 0.85)
const WHITE = rgb(1, 1, 1)
const ACCENT_BLUE = rgb(0.1, 0.35, 0.7)

// ─── Drawing helpers ─────────────────────────────────────────────────────────

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = BLACK
) {
  page.drawText(text, { x, y, font, size, color })
}

function drawHRule(page: PDFPage, y: number, thickness = 0.5, color = DARK_GRAY) {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness,
    color,
  })
}

function drawRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  fillColor = LIGHT_GRAY,
  borderColor?: typeof BLACK
) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: fillColor,
    borderColor,
    borderWidth: borderColor ? 0.5 : 0,
  })
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m) - 1]} ${d}, ${y}`
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function generateInvoiceNumber(supplierKey: SupplierKey): string {
  const prefixes: Record<SupplierKey, string> = {
    bluepoint: 'BP-INV',
    walmart: 'WM-INV',
    goldseal: 'GS-INV',
    samclub: 'SC-INV',
    odeko: 'OD-INV',
  }
  const seq = Math.floor(Math.random() * 9000) + 1000
  return `${prefixes[supplierKey]}-2026-${seq}`
}

// ─── Header block (shared) ───────────────────────────────────────────────────

function drawInvoiceHeader(
  page: PDFPage,
  boldFont: PDFFont,
  regularFont: PDFFont,
  supplier: (typeof SUPPLIERS)[SupplierKey],
  invoiceNumber: string,
  invoiceDate: string,
  dueDate: string,
  startY: number
): number {
  let y = startY

  // Supplier name
  drawText(page, supplier.invoiceLabel, MARGIN, y, boldFont, 18, ACCENT_BLUE)
  y -= 22

  // Supplier address + contact
  drawText(page, supplier.address, MARGIN, y, regularFont, 9, DARK_GRAY)
  y -= 13
  drawText(page, `Email: ${supplier.email}  |  Phone: ${supplier.phone}`, MARGIN, y, regularFont, 9, MID_GRAY)
  y -= 22

  drawHRule(page, y, 1.5, ACCENT_BLUE)
  y -= 18

  // INVOICE title
  drawText(page, 'INVOICE', MARGIN, y, boldFont, 20, BLACK)

  // Invoice meta on the right side
  const rightX = PAGE_WIDTH - MARGIN - 160
  drawText(page, 'Invoice #:', rightX, y, boldFont, 9)
  drawText(page, invoiceNumber, rightX + 65, y, regularFont, 9, DARK_GRAY)
  y -= 14
  drawText(page, 'Invoice Date:', rightX, y, boldFont, 9)
  drawText(page, formatDate(invoiceDate), rightX + 65, y, regularFont, 9, DARK_GRAY)
  y -= 14
  drawText(page, 'Due Date:', rightX, y, boldFont, 9)
  drawText(page, formatDate(dueDate), rightX + 65, y, regularFont, 9, DARK_GRAY)
  y -= 22

  // Bill To
  drawText(page, 'BILL TO', MARGIN, y, boldFont, 9, MID_GRAY)
  y -= 13
  drawText(page, 'The Little Cafe at Kaiser Permanente', MARGIN, y, boldFont, 10)
  y -= 13
  drawText(page, '10350 E Dakota Ave, Denver, CO 80247', MARGIN, y, regularFont, 9, DARK_GRAY)
  y -= 22

  drawHRule(page, y)
  y -= 14

  return y
}

// ─── Clean text layout (Bluepoint, Sam's Club style) ─────────────────────────

async function generateCleanTextInvoice(
  po: PurchaseOrderFixture,
  fees: { delivery: number; shipping: number; processing: number; other: number }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const regularFont = await doc.embedFont(StandardFonts.Helvetica)
  const obliqueFont = await doc.embedFont(StandardFonts.HelveticaOblique)

  const supplier = SUPPLIERS[po.supplierKey]
  const invoiceNumber = generateInvoiceNumber(po.supplierKey)
  const invoiceDate = po.expectedDeliveryDate
  const dueDate = new Date(new Date(invoiceDate).getTime() + 30 * 86400000)
    .toISOString().split('T')[0]

  let y = PAGE_HEIGHT - MARGIN
  y = drawInvoiceHeader(page, boldFont, regularFont, supplier, invoiceNumber, invoiceDate, dueDate, y)

  // Column headers
  drawText(page, 'ITEM / DESCRIPTION', MARGIN, y, boldFont, 9, MID_GRAY)
  drawText(page, 'SKU', MARGIN + 220, y, boldFont, 9, MID_GRAY)
  drawText(page, 'QTY', MARGIN + 310, y, boldFont, 9, MID_GRAY)
  drawText(page, 'UNIT PRICE', MARGIN + 360, y, boldFont, 9, MID_GRAY)
  drawText(page, 'TOTAL', MARGIN + 450, y, boldFont, 9, MID_GRAY)
  y -= 8
  drawHRule(page, y, 0.5, MID_GRAY)
  y -= 12

  // Line items
  for (const item of po.lineItems) {
    drawText(page, item.itemName, MARGIN, y, regularFont, 9)
    drawText(page, item.sku, MARGIN + 220, y, regularFont, 9, DARK_GRAY)
    drawText(page, String(item.quantityOrdered), MARGIN + 310, y, regularFont, 9)
    drawText(page, formatCurrency(item.unitCost), MARGIN + 360, y, regularFont, 9)
    drawText(page, formatCurrency(item.totalCost), MARGIN + 450, y, regularFont, 9)
    if (item.hasNoSquareId) {
      drawText(page, '(supply)', MARGIN + 2, y - 9, obliqueFont, 7, MID_GRAY)
      y -= 9
    }
    y -= 14

    if (y < 150) {
      // Safety: don't overflow page (these fixtures are short enough)
      break
    }
  }

  y -= 10
  drawHRule(page, y, 0.5, MID_GRAY)
  y -= 18

  // Subtotal
  const subtotal = po.lineItems.reduce((s, i) => s + i.totalCost, 0)
  const totalFees = fees.delivery + fees.shipping + fees.processing + fees.other
  const grandTotal = subtotal + totalFees

  const totalsX = MARGIN + 320

  drawText(page, 'Subtotal:', totalsX, y, regularFont, 9, DARK_GRAY)
  drawText(page, formatCurrency(subtotal), totalsX + 120, y, regularFont, 9)
  y -= 14

  if (fees.delivery > 0) {
    drawText(page, 'Delivery Fee:', totalsX, y, regularFont, 9, DARK_GRAY)
    drawText(page, formatCurrency(fees.delivery), totalsX + 120, y, regularFont, 9)
    y -= 14
  }
  if (fees.shipping > 0) {
    drawText(page, 'Shipping:', totalsX, y, regularFont, 9, DARK_GRAY)
    drawText(page, formatCurrency(fees.shipping), totalsX + 120, y, regularFont, 9)
    y -= 14
  }
  if (fees.processing > 0) {
    drawText(page, 'Processing Fee:', totalsX, y, regularFont, 9, DARK_GRAY)
    drawText(page, formatCurrency(fees.processing), totalsX + 120, y, regularFont, 9)
    y -= 14
  }
  if (fees.other > 0) {
    drawText(page, 'Other Fees:', totalsX, y, regularFont, 9, DARK_GRAY)
    drawText(page, formatCurrency(fees.other), totalsX + 120, y, regularFont, 9)
    y -= 14
  }

  drawHRule(page, y, 0.5)
  y -= 14
  drawText(page, 'TOTAL DUE:', totalsX, y, boldFont, 11)
  drawText(page, formatCurrency(grandTotal), totalsX + 120, y, boldFont, 11, ACCENT_BLUE)
  y -= 28

  // Footer
  drawText(
    page,
    `Thank you for your business!  |  Payment due within 30 days  |  ${supplier.email}`,
    MARGIN,
    MARGIN,
    obliqueFont,
    8,
    MID_GRAY
  )

  return doc.save()
}

// ─── Formatted table layout (Walmart, Gold Seal, Odeko style) ─────────────────

async function generateTableInvoice(
  po: PurchaseOrderFixture,
  fees: { delivery: number; shipping: number; processing: number; other: number },
  priceOverrides?: Partial<Record<string, number>>
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const regularFont = await doc.embedFont(StandardFonts.Helvetica)
  const obliqueFont = await doc.embedFont(StandardFonts.HelveticaOblique)

  const supplier = SUPPLIERS[po.supplierKey]
  const invoiceNumber = generateInvoiceNumber(po.supplierKey)
  const invoiceDate = po.expectedDeliveryDate
  const dueDate = new Date(new Date(invoiceDate).getTime() + 30 * 86400000)
    .toISOString().split('T')[0]

  let y = PAGE_HEIGHT - MARGIN
  y = drawInvoiceHeader(page, boldFont, regularFont, supplier, invoiceNumber, invoiceDate, dueDate, y)

  // Table header row
  const cols = {
    item: MARGIN,
    sku: MARGIN + 200,
    qty: MARGIN + 310,
    unit: MARGIN + 355,
    total: MARGIN + 435,
  }
  const rowHeight = 16
  const tableHeaderY = y

  drawRect(page, MARGIN, tableHeaderY - rowHeight + 4, CONTENT_WIDTH, rowHeight, rgb(0.2, 0.2, 0.2))
  drawText(page, 'Description', cols.item + 4, tableHeaderY - 8, boldFont, 8, WHITE)
  drawText(page, 'SKU/Item #', cols.sku + 4, tableHeaderY - 8, boldFont, 8, WHITE)
  drawText(page, 'Qty', cols.qty + 4, tableHeaderY - 8, boldFont, 8, WHITE)
  drawText(page, 'Unit Price', cols.unit + 4, tableHeaderY - 8, boldFont, 8, WHITE)
  drawText(page, 'Line Total', cols.total + 4, tableHeaderY - 8, boldFont, 8, WHITE)
  y = tableHeaderY - rowHeight - 4

  // Alternating row shading
  let rowIndex = 0
  for (const item of po.lineItems) {
    const unitCost = priceOverrides?.[item.inventoryItemId] ?? item.unitCost
    const lineTotal = item.quantityOrdered * unitCost

    if (rowIndex % 2 === 0) {
      drawRect(page, MARGIN, y - rowHeight + 4, CONTENT_WIDTH, rowHeight, rgb(0.96, 0.96, 0.96))
    }

    // Draw cell borders
    drawRect(page, MARGIN, y - rowHeight + 4, CONTENT_WIDTH, rowHeight, 
      rowIndex % 2 === 0 ? rgb(0.96, 0.96, 0.96) : WHITE, LIGHT_GRAY)

    const labelSuffix = item.hasNoSquareId ? ' [SUPPLY]' : ''
    drawText(page, item.itemName + labelSuffix, cols.item + 4, y - 8, regularFont, 8)
    drawText(page, item.sku, cols.sku + 4, y - 8, regularFont, 8, DARK_GRAY)
    drawText(page, String(item.quantityOrdered), cols.qty + 4, y - 8, regularFont, 8)
    drawText(page, formatCurrency(unitCost), cols.unit + 4, y - 8, regularFont, 8)
    drawText(page, formatCurrency(lineTotal), cols.total + 4, y - 8, regularFont, 8)

    y -= rowHeight + 2
    rowIndex++

    if (y < 160) break
  }

  // Fee rows (supplier fees — MOK-66)
  if (fees.delivery > 0) {
    if (rowIndex % 2 === 0) {
      drawRect(page, MARGIN, y - rowHeight + 4, CONTENT_WIDTH, rowHeight, rgb(0.96, 0.96, 0.96))
    }
    drawText(page, 'Delivery Fee', cols.item + 4, y - 8, obliqueFont, 8, MID_GRAY)
    drawText(page, '-', cols.sku + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, '1', cols.qty + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, formatCurrency(fees.delivery), cols.unit + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, formatCurrency(fees.delivery), cols.total + 4, y - 8, regularFont, 8, MID_GRAY)
    y -= rowHeight + 2
    rowIndex++
  }

  if (fees.shipping > 0) {
    if (rowIndex % 2 === 0) {
      drawRect(page, MARGIN, y - rowHeight + 4, CONTENT_WIDTH, rowHeight, rgb(0.96, 0.96, 0.96))
    }
    drawText(page, 'Shipping Charge', cols.item + 4, y - 8, obliqueFont, 8, MID_GRAY)
    drawText(page, '-', cols.sku + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, '1', cols.qty + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, formatCurrency(fees.shipping), cols.unit + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, formatCurrency(fees.shipping), cols.total + 4, y - 8, regularFont, 8, MID_GRAY)
    y -= rowHeight + 2
    rowIndex++
  }

  if (fees.processing > 0) {
    if (rowIndex % 2 === 0) {
      drawRect(page, MARGIN, y - rowHeight + 4, CONTENT_WIDTH, rowHeight, rgb(0.96, 0.96, 0.96))
    }
    drawText(page, 'Processing Fee', cols.item + 4, y - 8, obliqueFont, 8, MID_GRAY)
    drawText(page, '-', cols.sku + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, '1', cols.qty + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, formatCurrency(fees.processing), cols.unit + 4, y - 8, regularFont, 8, MID_GRAY)
    drawText(page, formatCurrency(fees.processing), cols.total + 4, y - 8, regularFont, 8, MID_GRAY)
    y -= rowHeight + 2
  }

  y -= 10
  drawHRule(page, y, 1)
  y -= 16

  // Totals block
  const subtotal = po.lineItems.reduce((s, i) => {
    const unitCost = priceOverrides?.[i.inventoryItemId] ?? i.unitCost
    return s + i.quantityOrdered * unitCost
  }, 0)
  const totalFees = fees.delivery + fees.shipping + fees.processing + fees.other
  const grandTotal = subtotal + totalFees

  const totalsX = MARGIN + 340
  drawText(page, 'Subtotal', totalsX, y, regularFont, 9, DARK_GRAY)
  drawText(page, formatCurrency(subtotal), totalsX + 110, y, regularFont, 9)
  y -= 14
  if (totalFees > 0) {
    drawText(page, 'Total Fees', totalsX, y, regularFont, 9, DARK_GRAY)
    drawText(page, formatCurrency(totalFees), totalsX + 110, y, regularFont, 9)
    y -= 14
  }

  drawRect(page, totalsX - 5, y - 4, CONTENT_WIDTH - totalsX + MARGIN + 5, 20, rgb(0.1, 0.35, 0.7))
  drawText(page, 'TOTAL DUE', totalsX, y + 4, boldFont, 10, WHITE)
  drawText(page, formatCurrency(grandTotal), totalsX + 110, y + 4, boldFont, 10, WHITE)
  y -= 30

  // Footer
  drawHRule(page, MARGIN + 16, 0.5, LIGHT_GRAY)
  drawText(
    page,
    `${supplier.invoiceLabel}  |  Invoice ${invoiceNumber}  |  Questions? ${supplier.email}`,
    MARGIN,
    MARGIN,
    obliqueFont,
    7,
    MID_GRAY
  )

  return doc.save()
}

// ─── Main generator ───────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // ── Bluepoint: clean text layout, delivery fee ──────────────────────────────
  console.log('Generating bluepoint invoice PDF...')
  const bluepointPdf = await generateCleanTextInvoice(BLUEPOINT_PO, {
    delivery: 15.00,
    shipping: 0,
    processing: 0,
    other: 0,
  })
  fs.writeFileSync(path.join(OUTPUT_DIR, 'bluepoint-invoice.pdf'), bluepointPdf)

  // ── Walmart: table layout, no fees (walk-in purchase) ──────────────────────
  console.log('Generating walmart invoice PDF...')
  const walmartPdf = await generateTableInvoice(WALMART_PO, {
    delivery: 0,
    shipping: 0,
    processing: 0,
    other: 0,
  })
  fs.writeFileSync(path.join(OUTPUT_DIR, 'walmart-invoice.pdf'), walmartPdf)

  // ── Gold Seal: table layout, delivery + processing fees ────────────────────
  console.log('Generating goldseal invoice PDF...')
  const goldsealPdf = await generateTableInvoice(GOLDSEAL_PO, {
    delivery: 22.50,
    shipping: 0,
    processing: 5.00,
    other: 0,
  })
  fs.writeFileSync(path.join(OUTPUT_DIR, 'goldseal-invoice.pdf'), goldsealPdf)

  // ── Sam's Club: clean text layout, delivery fee ─────────────────────────────
  console.log("Generating sam's club invoice PDF...")
  const samclubPdf = await generateCleanTextInvoice(SAMCLUB_PO, {
    delivery: 0,
    shipping: 0,
    processing: 0,
    other: 8.00,
  })
  fs.writeFileSync(path.join(OUTPUT_DIR, 'samclub-invoice.pdf'), samclubPdf)

  // ── Odeko: table layout, price variance on Cold Brew, delivery fee ──────────
  // Cold Brew unit cost on invoice ($12.00) differs from PO ($11.50) → triggers price variance exception
  console.log('Generating odeko invoice PDF...')
  const odekoPdf = await generateTableInvoice(
    ODEKO_PO,
    {
      delivery: 10.00,
      shipping: 0,
      processing: 2.50,
      other: 0,
    },
    {
      'inv-od-001': 12.00, // Override Cold Brew price (PO says $11.50 — variance of $0.50/unit)
    }
  )
  fs.writeFileSync(path.join(OUTPUT_DIR, 'odeko-invoice.pdf'), odekoPdf)

  console.log(`\n✓ 5 invoice PDFs written to ${OUTPUT_DIR}`)
  console.log('  bluepoint-invoice.pdf  — clean text, delivery fee')
  console.log('  walmart-invoice.pdf    — table layout, no fees (supplies + multi-supplier coffee)')
  console.log('  goldseal-invoice.pdf   — table layout, delivery + processing fees')
  console.log('  samclub-invoice.pdf    — clean text, other fee (multi-supplier coffee + bulk)')
  console.log('  odeko-invoice.pdf      — table layout, price variance on Cold Brew, delivery fee')
}

main().catch(err => {
  console.error('PDF generation failed:', err)
  process.exit(1)
})
