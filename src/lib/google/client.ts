/**
 * Google Workspace client for Cafe Pulse
 * Uses OAuth2 with long-lived refresh token (Mokesai shared account)
 * Credentials: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */

import { google } from 'googleapis'

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Google credentials. Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'
    )
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return auth
}

export function getSheets() {
  return google.sheets({ version: 'v4', auth: getOAuthClient() })
}

export function getDrive() {
  return google.drive({ version: 'v3', auth: getOAuthClient() })
}
