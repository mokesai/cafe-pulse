/**
 * pdf2json wrapper — extracts plain text from a PDF and computes a heuristic
 * confidence score. Mirrors the rough behavior of the production
 * src/lib/pdf-processor.ts text path so workflow A is a fair baseline.
 *
 * Confidence heuristic (best-effort; pdf2json doesn't report confidence):
 * - 0    if text is empty
 * - 0.3  if text length < 200 chars (likely image-only PDF or extraction failed)
 * - 0.5  base for any non-trivial text
 * - +0.1 for each invoice keyword found (invoice, total, qty/quantity, date, item),
 *        capped at 0.45
 * - clamped to [0, 1]
 */

import PDFParser from 'pdf2json'
import { readFile } from 'node:fs/promises'

export interface PdfTextResult {
  text: string
  confidence: number
  pageCount: number
  charCount: number
}

const INVOICE_KEYWORDS = ['invoice', 'total', 'qty', 'quantity', 'date', 'item']

export async function extractPdfText(pdfPath: string): Promise<PdfTextResult> {
  const buffer = await readFile(pdfPath)

  return new Promise<PdfTextResult>((resolve, reject) => {
    // pdf2json's typed surface is awkward — cast to a permissive shape.
    const parser = new (PDFParser as unknown as new () => {
      on: (e: string, cb: (data: unknown) => void) => void
      parseBuffer: (buf: Buffer) => void
    })()

    parser.on('pdfParser_dataError', (errData: unknown) => {
      const msg = (errData as { parserError?: { message?: string } })?.parserError?.message
        ?? String(errData)
      reject(new Error(`pdf2json error: ${msg}`))
    })

    parser.on('pdfParser_dataReady', (pdfData: unknown) => {
      const pages = (pdfData as { Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }> })
        .Pages ?? []

      const text = pages
        .map((page) =>
          (page.Texts ?? [])
            .map((t) =>
              (t.R ?? [])
                .map((r) => decodeURIComponent(r.T ?? ''))
                .join('')
            )
            .join(' ')
        )
        .join('\n\n')

      resolve({
        text,
        confidence: scoreConfidence(text),
        pageCount: pages.length,
        charCount: text.length,
      })
    })

    parser.parseBuffer(buffer)
  })
}

function scoreConfidence(text: string): number {
  if (!text || text.trim().length === 0) return 0
  if (text.length < 200) return 0.3

  const lower = text.toLowerCase()
  let score = 0.5
  for (const kw of INVOICE_KEYWORDS) {
    if (lower.includes(kw)) score += 0.1
  }
  return Math.min(1, Math.max(0, score))
}
