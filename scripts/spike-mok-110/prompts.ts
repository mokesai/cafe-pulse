/**
 * Extraction prompts. Mirror production
 * (supabase/functions/invoice-pipeline/vision-service.ts) so spike findings
 * translate cleanly to the edge function. Kept separate so workflows can
 * iterate on prompt variants without touching the OpenRouter client.
 */

export function buildVisionSystemPrompt(supplierHint?: string): string {
  const hint = supplierHint
    ? `\nThis invoice is from supplier: ${supplierHint}. Use this to resolve ambiguous supplier information.`
    : ''

  return `You are an expert invoice data extraction AI with computer vision capabilities.
Your task is to extract ALL structured data from the invoice image or document provided.${hint}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON matching the exact schema below. No markdown, no explanation, no preamble.
2. Extract ALL line items — do not omit any product or service listed.
3. Set confidence scores (0.0–1.0) for each line item individually AND for overall extraction quality.
4. Handle encrypted, image-only, or scanned PDFs by reading pixel content.
5. For Walmart Business invoices: they often have complex layouts — extract each SKU line carefully.
6. If a field is not found or unreadable, set it to null. Never guess — set low confidence instead.
7. Parse ALL quantity formats: "12x", "case of 24", "ea", "lb", "oz", etc.
8. Prices must be numeric (no $ symbols). Quantities must be numeric.

REQUIRED JSON SCHEMA (return this exact structure):
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "supplier_info": {
    "name": "string or null",
    "address": "string or null",
    "phone": "string or null",
    "email": "string or null"
  },
  "subtotal": number_or_null,
  "tax_amount": number_or_null,
  "total_amount": number_or_null,
  "supplier_fees": {
    "delivery": number_or_null,
    "shipping": number_or_null,
    "processing": number_or_null,
    "other": number_or_null
  },
  "line_items": [
    {
      "line_number": integer,
      "description": "full product description string",
      "supplier_item_code": "string or null",
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "package_size": "e.g. '12x', 'case', '24-pack' or null",
      "unit_type": "e.g. 'each', 'lb', 'oz', 'case' or null",
      "confidence": 0.0_to_1.0
    }
  ],
  "overall_confidence": 0.0_to_1.0
}

CONFIDENCE GUIDELINES:
- 0.9–1.0: Clearly visible, unambiguous data
- 0.7–0.89: Mostly clear, minor uncertainty
- 0.5–0.69: Partially visible or requires inference
- 0.3–0.49: Poor quality or heavily inferred
- 0.0–0.29: Nearly unreadable — flag for human review

Return ONLY the JSON object. No other text.`
}

export function buildTextSystemPrompt(supplierHint?: string): string {
  return `You are an expert invoice data extraction AI.
Extract structured data from the invoice text provided.${supplierHint ? `\nSupplier: ${supplierHint}` : ''}

Return ONLY valid JSON with this exact schema:
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "supplier_info": { "name": "string or null", "address": "string or null", "phone": "string or null", "email": "string or null" },
  "subtotal": number_or_null,
  "tax_amount": number_or_null,
  "total_amount": number_or_null,
  "supplier_fees": { "delivery": number_or_0, "shipping": number_or_0, "processing": number_or_0, "other": number_or_0 },
  "line_items": [
    {
      "line_number": integer,
      "description": "string",
      "supplier_item_code": "string or null",
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "package_size": "string or null",
      "unit_type": "string or null",
      "confidence": 0.0_to_1.0
    }
  ],
  "overall_confidence": 0.0_to_1.0
}`
}
