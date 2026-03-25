// TypeScript types for the Invoice Pipeline Exception Queue
// Corresponds to the invoice_exceptions table and related API routes.
// See architecture-invoice-cogs.md §4.3 and §4.4

export type InvoiceExceptionType =
  | 'low_extraction_confidence'  // overall Vision extraction confidence < threshold
  | 'no_supplier_match'          // extracted supplier text not found/creatable
  | 'no_po_match'                // no purchase order matches this invoice
  | 'no_item_match'              // line item cannot be matched to inventory item
  | 'price_variance'             // unit price change exceeds threshold
  | 'quantity_variance'          // quantity vs PO exceeds threshold
  | 'parse_error'                // pipeline failure (API error, malformed response)
  | 'duplicate_invoice'          // invoice_number already confirmed for this supplier

export type InvoiceExceptionStatus =
  | 'open'       // awaiting human review
  | 'resolved'   // human resolved; may have triggered downstream pipeline action
  | 'dismissed'  // human dismissed; no pipeline action taken

export interface InvoiceException {
  id: string
  tenant_id: string
  invoice_id: string
  invoice_item_id: string | null
  exception_type: InvoiceExceptionType
  exception_message: string
  exception_context: Record<string, unknown>
  status: InvoiceExceptionStatus
  resolution_notes: string | null
  resolved_by: string | null
  resolved_at: string | null
  pipeline_stage_at_creation: string | null
  created_at: string
  updated_at: string
  // Joined relations (from API response)
  invoices?: {
    invoice_number: string
    suppliers: { id: string; name: string } | null
  }
  invoice_items?: {
    item_description: string
    unit_price: number
    quantity: number
  } | null
}

// ============================================================
// ExceptionResolutionAction — discriminated union of all
// possible resolution payloads, keyed by `type`.
// Used in POST /api/admin/invoice-exceptions/[id]/resolve body.
// See architecture-invoice-cogs.md §4.3
// ============================================================

export type ExceptionResolutionAction =
  | {
      type: 'approve_and_continue'      // low_extraction_confidence: approved as-is
    }
  | {
      type: 'reupload_required'         // low_extraction_confidence: needs new file
    }
  | {
      type: 'select_supplier'           // no_supplier_match: pick existing
      supplier_id: string
    }
  | {
      type: 'create_supplier'           // no_supplier_match: create new
      supplier_name: string
      contact_email?: string
    }
  | {
      type: 'confirm_without_po'        // no_po_match
    }
  | {
      type: 'link_po'                   // no_po_match
      purchase_order_id: string
    }
  | {
      type: 'match_item'                // no_item_match: select existing inventory item
      inventory_item_id: string
    }
  | {
      type: 'create_and_match_item'     // no_item_match: create new inventory item
      item_name: string
      unit: string
      unit_cost: number
      category_id?: string
      sku?: string
    }
  | {
      type: 'skip_item'                 // no_item_match: skip this line item
    }
  | {
      type: 'approve_cost_update'       // price_variance: accept new price
    }
  | {
      type: 'reject_cost_update'        // price_variance: keep old price
    }
  | {
      type: 'confirm_quantity'          // quantity_variance
      accepted_quantity: number
    }
  | {
      type: 'retry_pipeline'            // parse_error
      from_stage?: string
    }
  | {
      type: 'dismiss_as_duplicate'      // duplicate_invoice
    }
  | {
      type: 'process_as_correction'     // duplicate_invoice
    }
  | {
      type: 'keep_both'                 // duplicate_invoice
    }

// ============================================================
// exception_context JSON schemas by type
// These match the JSONB structure stored in invoice_exceptions.exception_context
// See architecture-invoice-cogs.md §1.3.1
// ============================================================

export interface LowExtractionConfidenceContext {
  overall_confidence: number
  threshold: number
  per_field_confidence: {
    invoice_number: number
    invoice_date: number
    supplier_name: number
    total_amount: number
  }
  flagged_item_count: number
  file_url: string
}

export interface NoSupplierMatchContext {
  extracted_supplier_name: string
  suggested_suppliers: Array<{
    id: string
    name: string
    confidence: number
  }>
}

export interface NoPOMatchContext {
  invoice_total: number
  invoice_date: string
  supplier_id: string
  supplier_name: string
  search_window_days: number
}

export interface NoItemMatchContext {
  invoice_description: string
  invoice_unit_price: number
  invoice_quantity: number
  invoice_line_total: number
  best_fuzzy_matches: Array<{
    inventory_item_id: string
    item_name: string
    confidence: number
    unit_cost: number
  }>
}

export interface PriceVarianceContext {
  item_description: string
  inventory_item_id: string
  inventory_item_name: string
  previous_unit_cost: number
  invoice_unit_price: number
  variance_pct: number   // positive = increase, negative = decrease
  threshold_pct: number
  po_unit_cost: number | null
}

export interface QuantityVarianceContext {
  item_description: string
  inventory_item_id: string
  po_quantity: number
  invoice_quantity: number
  variance_pct: number
  threshold_pct: number
  purchase_order_id: string
  purchase_order_number: string
}

export interface ParseErrorContext {
  stage: string
  error_message: string
  retry_count: number
  fallback_attempted: boolean
}

export interface DuplicateInvoiceContext {
  existing_invoice_id: string
  existing_invoice_number: string
  existing_confirmed_at: string
  existing_total_amount: number
  new_total_amount: number
}

// API response types
export interface InvoiceExceptionListResponse {
  success: boolean
  data: InvoiceException[]
  open_count: number
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

export interface InvoiceExceptionDetailResponse {
  success: boolean
  data: InvoiceException & {
    invoice: {
      id: string
      invoice_number: string
      invoice_date: string
      total_amount: number
      pipeline_stage: string | null
      supplier_id: string | null
      suppliers: { id: string; name: string } | null
    }
    invoice_item: {
      id: string
      item_description: string
      unit_price: number
      quantity: number
    } | null
    other_open_exceptions_count: number
  }
}

export interface ResolveExceptionResponse {
  success: boolean
  exception_id: string
  invoice_auto_confirmed: boolean
  pipeline_continued: boolean
}

export interface DismissExceptionResponse {
  success: boolean
  exception_id: string
}

export interface BulkDismissExceptionResponse {
  success: boolean
  dismissed_count: number
  failed_ids: string[]
}
