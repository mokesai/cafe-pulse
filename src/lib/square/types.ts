// Square configuration interface
// Encapsulates all credentials needed for Square API calls

export interface SquareConfig {
  accessToken: string
  applicationId: string
  locationId: string
  environment: 'sandbox' | 'production'
  merchantId?: string
  webhookSignatureKey?: string
}
