import type { SquareConfig } from './types'

interface CustomerCard {
  id: string
  cardBrand: string
  last4: string
  expMonth: number
  expYear: number
  cardholderName?: string
}

interface CreateCustomerCardRequest {
  sourceId: string // Payment token from Square Web Payments SDK
  cardholderName?: string
  billingAddress?: {
    addressLine1?: string
    locality?: string
    administrativeDistrictLevel1?: string
    postalCode?: string
  }
}

export async function createSquareCustomer(_config: SquareConfig, _email: string, _fullName?: string): Promise<string> {
  void _config
  void _email
  void _fullName
  try {
    // Temporarily disable customer creation until API method is verified
    throw new Error('Customer creation temporarily disabled')
    
    // const { result } = await customersApi.createCustomer({
    //   emailAddress: email,
    //   ...(fullName && { givenName: fullName.split(' ')[0], familyName: fullName.split(' ').slice(1).join(' ') })
    // })
    
    // if (!result.customer?.id) {
    //   throw new Error('Failed to create customer: No customer ID returned')
    // }
    
    // return result.customer.id
  } catch (error) {
    console.error('Error creating Square customer:', error)
    throw new Error('Failed to create customer')
  }
}

export async function getSquareCustomer(_config: SquareConfig, _customerId: string) {
  void _config
  void _customerId
  try {
    // Temporarily disable until API method is verified
    throw new Error('Customer retrieval temporarily disabled')
    // const { result } = await customersApi.retrieveCustomer(customerId)
    // return result.customer
  } catch (error) {
    console.error('Error retrieving Square customer:', error)
    throw new Error('Failed to retrieve customer')
  }
}

export async function searchSquareCustomerByEmail(_config: SquareConfig, _email: string): Promise<string | null> {
  void _config
  void _email
  // Temporarily disabled - return null for now
  return null
}

export async function saveCustomerCard(
  _config: SquareConfig,
  _customerId: string,
  _cardRequest: CreateCustomerCardRequest
): Promise<string> {
  void _config
  void _customerId
  void _cardRequest
  // Temporarily disabled - throw error for now
  throw new Error('Card saving temporarily disabled - Square Customer API integration pending')
}

export async function getCustomerCards(_config: SquareConfig, _customerId: string): Promise<CustomerCard[]> {
  void _config
  void _customerId
  // Temporarily disabled - return empty array for now
  return []
}

export async function deleteCustomerCard(_config: SquareConfig, _customerId: string, _cardId: string): Promise<void> {
  void _config
  void _customerId
  void _cardId
  // Temporarily disabled - throw error for now
  throw new Error('Card deletion temporarily disabled')
}

export async function findOrCreateCustomer(_config: SquareConfig, _email: string, _fullName?: string): Promise<string> {
  void _config
  void _email
  void _fullName
  // Temporarily disabled - throw error for now
  throw new Error('Customer management temporarily disabled')
}
