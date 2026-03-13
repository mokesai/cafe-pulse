import { listCatalogTaxes } from './fetch-client'
import type { SquareConfig } from './types'

interface CatalogTaxObject {
  id: string
  tax_data?: {
    name?: string
    percentage?: string
    enabled?: boolean
  }
}

interface CatalogTaxResponse {
  objects?: CatalogTaxObject[]
}

export interface TaxConfiguration {
  taxId: string
  name: string
  percentage: string
  enabled: boolean
}

export class TaxConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxConfigurationError'
  }
}

/**
 * Validates that Square has proper tax configuration
 * Throws TaxConfigurationError if taxes are not configured
 */
export async function validateTaxConfiguration(config: SquareConfig): Promise<TaxConfiguration> {
  try {
    const taxesResult = await listCatalogTaxes(config) as CatalogTaxResponse
    
    if (!taxesResult.objects || taxesResult.objects.length === 0) {
      throw new TaxConfigurationError(
        'No tax configuration found in Square. Please configure sales tax in your Square account before processing orders. ' +
        'For sandbox testing, run the Square initialization script to set up test tax rates.'
      )
    }
    
    // Filter for enabled taxes only
    const enabledTaxes = taxesResult.objects.filter((taxObj): taxObj is CatalogTaxObject & { tax_data: Required<CatalogTaxObject['tax_data']> } => 
      taxObj.tax_data?.enabled === true
    )
    
    if (enabledTaxes.length === 0) {
      throw new TaxConfigurationError(
        'No enabled tax configuration found in Square. Please enable tax calculation in your Square account before processing orders.'
      )
    }
    
    // Get the first enabled tax configuration
    const taxObject = enabledTaxes[0]
    
    if (!taxObject.tax_data) {
      throw new TaxConfigurationError(
        'Invalid tax configuration found in Square. Tax object missing tax_data.'
      )
    }
    
    const taxData = taxObject.tax_data
    
    if (!taxData.enabled) {
      throw new TaxConfigurationError(
        'Tax configuration is disabled in Square. Please enable tax calculation in your Square account.'
      )
    }
    
    if (!taxData.percentage) {
      throw new TaxConfigurationError(
        'Tax configuration missing percentage rate in Square. Please configure proper tax rates.'
      )
    }
    
    return {
      taxId: taxObject.id,
      name: taxData.name || 'Sales Tax',
      percentage: taxData.percentage,
      enabled: taxData.enabled
    }
    
  } catch (error) {
    if (error instanceof TaxConfigurationError) {
      throw error
    }
    
    // Handle other API errors
    console.error('Error validating tax configuration:', error)
    throw new TaxConfigurationError(
      'Unable to validate tax configuration. Please check your Square account setup and network connection.'
    )
  }
}

/**
 * Gets tax configuration for frontend display
 * Returns null if no tax configuration (caller should handle gracefully)
 */
export async function getTaxConfiguration(config: SquareConfig): Promise<TaxConfiguration | null> {
  try {
    return await validateTaxConfiguration(config)
  } catch (error) {
    console.warn('Tax configuration not available:', error instanceof Error ? error.message : error)
    return null
  }
}
