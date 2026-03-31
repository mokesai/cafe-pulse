/**
 * Server-side API error formatting helpers (MOK-64)
 *
 * Provides descriptive, actionable error messages for API routes instead
 * of leaking raw DB errors or generic "Internal server error" strings.
 *
 * Usage:
 *   import { formatApiError, apiError } from '@/lib/api/errors'
 *
 *   // Wrap a Postgres/Supabase error:
 *   if (error) return formatApiError('create inventory item', error)
 *
 *   // Build a plain error response:
 *   return apiError('Invoice item not found — it may have been deleted', 404)
 */

import { NextResponse } from 'next/server'
import type { PostgrestError } from '@supabase/supabase-js'

// ─────────────────────────────────────────────
// Postgres error codes we handle explicitly
// ─────────────────────────────────────────────

/** Unique-constraint violation */
const PG_UNIQUE_VIOLATION = '23505'
/** Foreign-key violation */
const PG_FOREIGN_KEY_VIOLATION = '23503'
/** Not-null constraint violation */
const PG_NOT_NULL_VIOLATION = '23502'
/** Check constraint violation */
const PG_CHECK_VIOLATION = '23514'
/** Row not returned (PostgREST "no rows" sentinel) */
const PGRST_NO_ROW = 'PGRST116'

// ─────────────────────────────────────────────
// Human-readable messages per operation context
// ─────────────────────────────────────────────

/**
 * Maps a Postgres/PostgREST error code + operation context to a descriptive
 * message. Falls back to a safe generic for unknown codes.
 */
function describeDbError(
  context: string,
  error: PostgrestError | { code?: string; message?: string; details?: string; hint?: string }
): { message: string; status: number; code?: string } {
  const code = error.code ?? ''

  switch (code) {
    case PG_UNIQUE_VIOLATION:
      return describeUniqueViolation(context, error as PostgrestError)

    case PG_FOREIGN_KEY_VIOLATION:
      return describeForeignKeyViolation(context, error as PostgrestError)

    case PG_NOT_NULL_VIOLATION:
      return {
        message: `Failed to ${context}: a required field is missing. Check that all required values are provided.`,
        status: 400,
        code: 'MISSING_REQUIRED_FIELD',
      }

    case PG_CHECK_VIOLATION:
      return {
        message: `Failed to ${context}: a value is out of the allowed range. Check numeric fields like quantity or cost.`,
        status: 400,
        code: 'CONSTRAINT_VIOLATION',
      }

    case PGRST_NO_ROW:
      return {
        message: `Failed to ${context}: record not found.`,
        status: 404,
        code: 'NOT_FOUND',
      }

    default:
      // Don't leak raw DB messages in production — log them server-side, return safe copy.
      return {
        message: `Failed to ${context}. Please try again or contact support if the problem persists.`,
        status: 500,
      }
  }
}

// ─────────────────────────────────────────────
// Context-aware unique-violation messages
// ─────────────────────────────────────────────

function describeUniqueViolation(
  context: string,
  error: PostgrestError
): { message: string; status: number; code: string } {
  const msg = (error.message ?? '').toLowerCase()
  const detail = (error.details ?? '').toLowerCase()

  // Inventory: supplier + Square item ID + pack size
  if (
    msg.includes('inventory_items') ||
    detail.includes('square_item_id') ||
    context.includes('inventory')
  ) {
    if (detail.includes('pack_size') || detail.includes('square_item_id')) {
      return {
        message:
          'This supplier already has an inventory item with the same Square item ID and pack size. ' +
          'Each supplier can only link to a given Square item once per pack size.',
        status: 409,
        code: 'DUPLICATE_SUPPLIER_ITEM',
      }
    }
    return {
      message: 'An inventory item with this name or ID already exists.',
      status: 409,
      code: 'DUPLICATE_INVENTORY_ITEM',
    }
  }

  // Invoices: duplicate invoice number per supplier
  if (msg.includes('invoice') || context.includes('invoice')) {
    return {
      message:
        'An invoice with this number already exists for this supplier. ' +
        'Use a unique invoice number or update the existing invoice.',
      status: 409,
      code: 'DUPLICATE_INVOICE',
    }
  }

  // Suppliers: duplicate name
  if (msg.includes('supplier') || context.includes('supplier')) {
    return {
      message:
        'A supplier with this name already exists. ' +
        'Please use a unique name or update the existing supplier.',
      status: 409,
      code: 'DUPLICATE_SUPPLIER',
    }
  }

  // Supplier item aliases
  if (msg.includes('supplier_item_aliases') || context.includes('alias')) {
    return {
      message: 'This item alias already exists for this supplier.',
      status: 409,
      code: 'DUPLICATE_ALIAS',
    }
  }

  // Generic fallback
  return {
    message: `Failed to ${context}: a record with these values already exists.`,
    status: 409,
    code: 'DUPLICATE_RECORD',
  }
}

// ─────────────────────────────────────────────
// Foreign-key violation messages
// ─────────────────────────────────────────────

function describeForeignKeyViolation(
  context: string,
  error: PostgrestError
): { message: string; status: number; code: string } {
  const detail = (error.details ?? '').toLowerCase()

  if (detail.includes('supplier_id') || context.includes('supplier')) {
    return {
      message:
        'The referenced supplier does not exist or has been deleted. ' +
        'Select a valid supplier and try again.',
      status: 422,
      code: 'INVALID_SUPPLIER_REFERENCE',
    }
  }

  if (detail.includes('inventory_item') || context.includes('inventory')) {
    return {
      message:
        'The referenced inventory item does not exist. ' +
        'It may have been deleted — refresh and try again.',
      status: 422,
      code: 'INVALID_INVENTORY_REFERENCE',
    }
  }

  if (detail.includes('invoice') || context.includes('invoice')) {
    return {
      message:
        'The referenced invoice does not exist. ' +
        'It may have been deleted — refresh and try again.',
      status: 422,
      code: 'INVALID_INVOICE_REFERENCE',
    }
  }

  return {
    message: `Failed to ${context}: a referenced record no longer exists.`,
    status: 422,
    code: 'INVALID_REFERENCE',
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

type DbError =
  | PostgrestError
  | { code?: string; message?: string; details?: string; hint?: string }
  | null
  | undefined

/**
 * Format a Supabase/Postgres error into a descriptive NextResponse JSON error.
 *
 * @param context  Short human-readable description of what was being attempted,
 *                 e.g. "create inventory item" or "match invoice item".
 *                 Used in both the response message and server-side logs.
 * @param error    The Supabase PostgrestError (or any error-like object).
 * @param extra    Optional extra fields merged into the response body.
 */
export function formatApiError(
  context: string,
  error: DbError,
  extra?: Record<string, unknown>
): NextResponse {
  if (!error) {
    return NextResponse.json(
      { error: `Failed to ${context}. An unknown error occurred.`, ...extra },
      { status: 500 }
    )
  }

  const { message, status, code } = describeDbError(context, error)

  // Always log the raw error server-side for debugging
  console.error(`[API error] ${context}:`, {
    code: (error as PostgrestError).code,
    message: (error as PostgrestError).message,
    details: (error as PostgrestError).details,
    hint: (error as PostgrestError).hint,
  })

  const body: Record<string, unknown> = { error: message, ...extra }
  if (code) body.code = code

  return NextResponse.json(body, { status })
}

/**
 * Build a plain error response without a DB error.
 * Use for business-logic validation that doesn't touch the database.
 *
 * @param message  Clear, actionable error message shown to the user.
 * @param status   HTTP status code (default 400).
 * @param code     Optional machine-readable error code.
 */
export function apiError(
  message: string,
  status = 400,
  code?: string
): NextResponse {
  const body: Record<string, unknown> = { error: message }
  if (code) body.code = code
  return NextResponse.json(body, { status })
}

/**
 * Wrap an unexpected catch-block error into a safe NextResponse.
 *
 * @param context  Short description of the operation that failed.
 * @param error    The raw caught value (anything).
 */
export function unexpectedError(context: string, error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[Unexpected error] ${context}:`, error)
  return NextResponse.json(
    {
      error: `An unexpected error occurred while trying to ${context}. Please try again.`,
      // Include details only in non-production environments
      ...(process.env.NODE_ENV !== 'production' && { details: message }),
    },
    { status: 500 }
  )
}
