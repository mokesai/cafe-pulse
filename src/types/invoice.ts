// TypeScript interfaces for Invoice Import System

export interface Invoice {
  id: string
  supplier_id: string
  invoice_number: string
  invoice_date: string
  due_date?: string
  total_amount: number
  
  // File storage
  file_url?: string
  file_name?: string
  file_size?: number
  file_type?: string
  file_path?: string
  raw_text?: string
  clean_text?: string
  text_analysis?: InvoiceTextAnalysis

  // Processing status
  status: InvoiceStatus

  // Pipeline tracking (agentic invoice pipeline)
  pipeline_stage?: PipelineStage | null
  pipeline_started_at?: string | null
  pipeline_completed_at?: string | null
  pipeline_error?: string | null
  vision_confidence?: number | null  // 0.0–1.0
  open_exception_count?: number
  
  // AI parsing results
  parsed_data?: ParsedInvoiceData
  parsing_confidence?: number // 0-1
  parsing_error?: string
  
  // Processing metadata
  created_at: string
  updated_at: string
  created_by?: string
  processed_at?: string
  processed_by?: string
  
  // Relations
  suppliers?: {
    id: string
    name: string
    contact_person?: string
    email?: string
  }
  invoice_items?: InvoiceItem[]
  order_invoice_matches?: OrderInvoiceMatch[]
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  
  // Parsed item data
  line_number: number
  item_description: string
  supplier_item_code?: string
  
  // Quantities and pricing
  quantity: number
  unit_price: number
  total_price: number
  
  // Package handling
  package_size?: string // "12x", "24x", "case", "each"
  unit_type?: string // "each", "lb", "oz", "case"
  units_per_package: number
  
  // Matching results
  matched_item_id?: string
  match_confidence?: number // 0-1
  match_method?: MatchMethod
  
  // Status and review
  is_reviewed: boolean
  review_notes?: string
  
  created_at: string
  updated_at: string
  
  // Relations
  inventory_items?: {
    id: string
    item_name: string
    current_stock: number
    unit_cost: number
  }
}

export interface OrderInvoiceMatch {
  id: string
  purchase_order_id: string
  invoice_id: string
  
  // Matching metadata
  match_confidence: number // 0-1
  match_method: MatchMethod
  
  // Status tracking
  status: MatchStatus
  
  // Variance tracking
  quantity_variance?: number
  amount_variance?: number
  variance_notes?: string
  
  // Review and approval
  reviewed_by?: string
  reviewed_at?: string
  review_notes?: string
  
  created_at: string
  updated_at: string
  
  // Relations
  purchase_orders?: {
    id: string
    order_number: string
    status: string
    order_date: string
    expected_delivery_date?: string
    total_amount: number
  }
}

export interface SupplierInvoiceTemplate {
  id: string
  supplier_id: string
  
  // Template metadata
  template_name: string
  template_version: string
  is_active: boolean
  
  // Parsing configuration
  format_config: Record<string, unknown> // AI parsing instructions
  parsing_rules: Record<string, unknown> // Field extraction rules
  package_mappings: Record<string, unknown> // Package size mappings
  
  // Item matching rules
  item_matching_rules: Record<string, unknown>
  default_unit_conversions: Record<string, unknown>
  
  // Template usage tracking
  usage_count: number
  last_used_at?: string
  success_rate?: number // 0-1
  
  created_at: string
  updated_at: string
  created_by?: string
}

export interface InvoiceImportSession {
  id: string
  invoice_id: string
  user_id: string
  
  // Session status
  status: SessionStatus
  
  // Review process data
  review_data: Record<string, unknown>
  step_progress: number
  total_steps: number
  
  // Timing information
  started_at: string
  last_activity_at: string
  completed_at?: string
  
  // Session metadata
  user_agent?: string
  ip_address?: string
  
  created_at: string
  updated_at: string
}

export interface InvoiceTextAnalysis {
  extraction_method?: string
  text_length?: number
  raw_text_length?: number
  line_count?: number
  page_count?: number
  keyword_matches?: number
  line_item_candidates?: number
  is_valid?: boolean
  needs_ocr?: boolean
  needs_manual_review?: boolean
  normalization_steps?: string[]
  indicators?: string[]
  warnings?: string[]
  validation_confidence?: number
  ocr_confidence?: number
  metadata?: Record<string, unknown>
}

// Enums and Types
export type InvoiceStatus = 
  | 'uploaded'
  | 'parsing'            // legacy: manual parse in progress
  | 'parsed'             // legacy: manual parse done
  | 'reviewing'          // legacy: manual review
  | 'matched'            // legacy: manual match done
  | 'pipeline_running'   // NEW: agentic pipeline executing
  | 'pending_exceptions' // NEW: pipeline paused, open exceptions exist
  | 'confirmed'          // auto or manual confirmation complete
  | 'error'              // unrecoverable pipeline or parse failure
  | 'duplicate'          // NEW: identified as duplicate, blocked

export type PipelineStage =
  | 'extracting'
  | 'resolving_supplier'
  | 'matching_po'
  | 'matching_items'
  | 'confirming'
  | 'completed'
  | 'failed'

export type MatchMethod = 
  | 'exact'
  | 'fuzzy'
  | 'manual'
  | 'sku'
  | 'ai'

export type MatchStatus = 
  | 'pending'
  | 'reviewing'
  | 'confirmed'
  | 'rejected'

export type SessionStatus = 
  | 'active'
  | 'completed'
  | 'abandoned'
  | 'error'

// Parsed Invoice Data Structure (from AI)
export interface ParsedInvoiceData {
  // Document metadata
  invoice_number?: string
  invoice_date?: string
  due_date?: string
  supplier_info?: {
    name?: string
    address?: string
    phone?: string
    email?: string
  }
  
  // Financial totals
  subtotal?: number
  tax_amount?: number
  discount_amount?: number
  total_amount?: number
  
  // Line items
  line_items?: ParsedLineItem[]
  
  // Parsing metadata
  confidence_score?: number
  parsing_method?: string
  extraction_timestamp?: string
  raw_text?: string
}

export interface ParsedLineItem {
  line_number?: number
  item_code?: string
  description?: string
  quantity?: number
  unit_price?: number
  total_price?: number
  package_info?: string
  unit_type?: string
  confidence?: number
}

// API Response Types
export interface InvoiceListResponse {
  success: boolean
  data: Invoice[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

export interface InvoiceResponse {
  success: boolean
  data: Invoice
  message?: string
}

export interface InvoiceUploadResponse {
  success: boolean
  data: Invoice
  message?: string
}

// Form Types
export interface InvoiceUploadForm {
  supplier_id: string
  invoice_number: string
  invoice_date: string
  file: File
}

export interface InvoiceReviewForm {
  invoice_id: string
  items: InvoiceItemReview[]
  order_matches: OrderMatchReview[]
}

export interface InvoiceItemReview {
  id: string
  matched_item_id?: string
  quantity: number
  unit_price: number
  is_approved: boolean
  review_notes?: string
}

export interface OrderMatchReview {
  purchase_order_id: string
  is_confirmed: boolean
  variance_notes?: string
}

// Package Conversion Types
export interface PackageConversion {
  package_type: string // "12x", "24x", "case"
  units_per_package: number
  unit_type: string // "each", "can", "bottle"
  total_units: number
}

export interface ConversionRule {
  supplier_id: string
  item_pattern: string // Regex pattern to match items
  package_mappings: Record<string, number> // {"12x": 12, "case": 24}
  default_unit_type: string
}

// AI Integration Types
export interface AIParseRequest {
  invoice_id: string
  file_url: string
  supplier_template?: SupplierInvoiceTemplate
}

export interface AIParseResponse {
  success: boolean
  data: ParsedInvoiceData
  confidence: number
  errors?: string[]
}

export interface ItemMatchingSuggestion {
  invoice_item_id: string
  suggested_matches: Array<{
    inventory_item_id: string
    item_name: string
    confidence: number
    reasoning: string
    current_stock: number
    unit_cost: number
  }>
}

// Statistics and Analytics
export interface InvoiceStats {
  total_invoices: number
  pending_review: number
  confirmed_invoices: number
  error_invoices: number
  average_processing_time: number // minutes
  parsing_success_rate: number // 0-1
}

export interface SupplierInvoiceStats {
  supplier_id: string
  supplier_name: string
  total_invoices: number
  success_rate: number
  average_confidence: number
  last_invoice_date: string
}
