// QuickBooks Online OAuth and invoice push.

import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { db, auth } from './common'

// ── QuickBooks Online sync ───────────────────────────────────────────────────
// One-way invoice push (CRM → QuickBooks), connected via OAuth2. Tokens live
// in quickbooksTokens/{companyId} (Cloud-Functions-only, never exposed to the
// client); connection *status* only (no secrets) mirrors to
// companies/{companyId}/settings/quickbooksStatus so the client can show
// "Connected" without ever seeing a token.
//
// Setup: register an app at https://developer.intuit.com, set its redirect
// URI to https://us-central1-thelightui.cloudfunctions.net/quickbooksOAuthCallback,
// and set secrets QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET. Optionally
// set QUICKBOOKS_ENV=production once out of the sandbox (defaults to sandbox
// so a misconfigured connection can't accidentally write into a real company).
//
// Scope note: this pushes each invoice as a single QuickBooks "Services" line
// item per CRM line item (Amount overridden to match our qty*rate) rather
// than mapping a full product/service catalog — a deliberate simplification,
// not an oversight.

const QUICKBOOKS_REDIRECT_URI = 'https://us-central1-thelightui.cloudfunctions.net/quickbooksOAuthCallback'

function quickbooksApiBase(): string {
  return process.env.QUICKBOOKS_ENV === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

export const quickbooksConnect = functions
  .runWith({ secrets: ['QUICKBOOKS_CLIENT_ID'] })
  .https.onCall(async (_data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    const companyId = context.auth.token.companyId as string
    if (!companyId) throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')

    const clientId = process.env.QUICKBOOKS_CLIENT_ID
    if (!clientId) throw new functions.https.HttpsError('unavailable', 'QuickBooks integration is not configured')

    const state = randomUUID()
    await db.collection('oauthStates').doc(state).set({
      companyId, provider: 'quickbooks', createdAt: FieldValue.serverTimestamp(),
    })

    const url = 'https://appcenter.intuit.com/connect/oauth2?' + new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: QUICKBOOKS_REDIRECT_URI,
      state,
    }).toString()

    return { url }
  })

export const quickbooksOAuthCallback = functions
  .runWith({ secrets: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'] })
  .https.onRequest(async (req, res) => {
    const { code, state, realmId } = req.query as Record<string, string>
    try {
      if (!code || !state || !realmId) throw new Error('Missing code/state/realmId')

      const stateSnap = await db.collection('oauthStates').doc(state).get()
      if (!stateSnap.exists) throw new Error('Invalid or expired state')
      const companyId = String(stateSnap.data()?.['companyId'] ?? '')
      await stateSnap.ref.delete()
      if (!companyId) throw new Error('No company on state')

      const clientId     = process.env.QUICKBOOKS_CLIENT_ID!
      const clientSecret  = process.env.QUICKBOOKS_CLIENT_SECRET!

      const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: QUICKBOOKS_REDIRECT_URI,
        }).toString(),
      })
      if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`)
      const tokenJson = await tokenRes.json() as Record<string, unknown>

      await db.collection('quickbooksTokens').doc(companyId).set({
        accessToken:  String(tokenJson['access_token']  ?? ''),
        refreshToken: String(tokenJson['refresh_token'] ?? ''),
        realmId,
        accessTokenExpiresAt: Timestamp.fromMillis(Date.now() + Number(tokenJson['expires_in'] ?? 3600) * 1000),
      })
      await db.collection('companies').doc(companyId).collection('settings').doc('quickbooksStatus').set({
        connected: true, realmId, connectedAt: FieldValue.serverTimestamp(),
      })

      res.redirect(302, 'https://thelightui.web.app/quickbooks?connected=1')
    } catch (err) {
      console.error('quickbooksOAuthCallback error:', err)
      res.redirect(302, 'https://thelightui.web.app/quickbooks?connected=0')
    }
  })

export const quickbooksDisconnect = functions
  .runWith({ secrets: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'] })
  .https.onCall(async (_data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    const companyId = context.auth.token.companyId as string
    if (!companyId) throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')

    const tokenRef  = db.collection('quickbooksTokens').doc(companyId)
    const tokenSnap = await tokenRef.get()
    const refreshToken = String(tokenSnap.data()?.['refreshToken'] ?? '')
    const clientId     = process.env.QUICKBOOKS_CLIENT_ID
    const clientSecret  = process.env.QUICKBOOKS_CLIENT_SECRET

    if (refreshToken && clientId && clientSecret) {
      try {
        await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ token: refreshToken }),
        })
      } catch (err) {
        console.error('quickbooksDisconnect: revoke failed (clearing local connection anyway):', err)
      }
    }

    await tokenRef.delete()
    await db.collection('companies').doc(companyId).collection('settings').doc('quickbooksStatus')
      .set({ connected: false }, { merge: true })

    return { success: true }
  })

async function getValidQuickBooksAccessToken(companyId: string): Promise<{ accessToken: string; realmId: string }> {
  const ref  = db.collection('quickbooksTokens').doc(companyId)
  const snap = await ref.get()
  if (!snap.exists) throw new functions.https.HttpsError('failed-precondition', 'QuickBooks is not connected')
  const data = snap.data() ?? {}
  const realmId   = String(data['realmId'] ?? '')
  const expiresAt = (data['accessTokenExpiresAt'] as Timestamp | undefined)?.toMillis() ?? 0

  if (Date.now() < expiresAt - 60_000) {
    return { accessToken: String(data['accessToken'] ?? ''), realmId }
  }

  const clientId     = process.env.QUICKBOOKS_CLIENT_ID
  const clientSecret  = process.env.QUICKBOOKS_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new functions.https.HttpsError('unavailable', 'QuickBooks integration is not configured')

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: String(data['refreshToken'] ?? '') }).toString(),
  })
  if (!res.ok) throw new functions.https.HttpsError('internal', `QuickBooks token refresh failed: ${await res.text()}`)
  const json = await res.json() as Record<string, unknown>

  const accessToken  = String(json['access_token']  ?? '')
  const refreshToken = String(json['refresh_token'] ?? data['refreshToken'] ?? '')
  await ref.update({
    accessToken, refreshToken,
    accessTokenExpiresAt: Timestamp.fromMillis(Date.now() + Number(json['expires_in'] ?? 3600) * 1000),
  })
  return { accessToken, realmId }
}

async function qbFetch(
  accessToken: string, realmId: string, path: string, init?: { method?: string; body?: string },
): Promise<Record<string, unknown>> {
  const res = await fetch(`${quickbooksApiBase()}/v3/company/${realmId}${path}`, {
    method: init?.method ?? 'GET',
    body: init?.body,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  })
  const json = await res.json() as Record<string, unknown>
  if (!res.ok) throw new functions.https.HttpsError('internal', `QuickBooks API error: ${JSON.stringify(json)}`)
  return json
}

async function findOrCreateQuickBooksCustomer(accessToken: string, realmId: string, displayName: string): Promise<string> {
  const safeName = displayName.replace(/'/g, "\\'")
  const query = await qbFetch(accessToken, realmId, `/query?query=${encodeURIComponent(`select Id from Customer where DisplayName = '${safeName}'`)}`)
  const existing = (query['QueryResponse'] as Record<string, unknown> | undefined)?.['Customer'] as Record<string, unknown>[] | undefined
  if (existing?.[0]?.['Id']) return String(existing[0]['Id'])

  const created = await qbFetch(accessToken, realmId, '/customer', {
    method: 'POST',
    body: JSON.stringify({ DisplayName: displayName }),
  })
  return String((created['Customer'] as Record<string, unknown>)['Id'])
}

// Every pushed invoice line uses this one generic "Services" item — see the
// scope note above the QuickBooks section header.
async function findOrCreateQuickBooksServiceItem(accessToken: string, realmId: string): Promise<string> {
  const query = await qbFetch(accessToken, realmId, `/query?query=${encodeURIComponent("select Id from Item where Name = 'Services'")}`)
  const existing = (query['QueryResponse'] as Record<string, unknown> | undefined)?.['Item'] as Record<string, unknown>[] | undefined
  if (existing?.[0]?.['Id']) return String(existing[0]['Id'])

  const incomeAccountQuery = await qbFetch(accessToken, realmId, `/query?query=${encodeURIComponent("select Id from Account where AccountType = 'Income' maxresults 1")}`)
  const incomeAccounts = (incomeAccountQuery['QueryResponse'] as Record<string, unknown> | undefined)?.['Account'] as Record<string, unknown>[] | undefined
  if (!incomeAccounts?.[0]?.['Id']) {
    throw new functions.https.HttpsError('failed-precondition', 'No income account found in QuickBooks to attach the default service item to')
  }

  const created = await qbFetch(accessToken, realmId, '/item', {
    method: 'POST',
    body: JSON.stringify({
      Name: 'Services',
      Type: 'Service',
      IncomeAccountRef: { value: String(incomeAccounts[0]['Id']) },
    }),
  })
  return String((created['Item'] as Record<string, unknown>)['Id'])
}

export const pushInvoiceToQuickBooks = functions
  .runWith({ secrets: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'], timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    const companyId = context.auth.token.companyId as string
    if (!companyId) throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')

    const { invoiceId } = data as { invoiceId: string }
    if (!invoiceId) throw new functions.https.HttpsError('invalid-argument', 'invoiceId is required')

    const invSnap = await db.collection('Invoices').doc(invoiceId).get()
    if (!invSnap.exists || invSnap.data()?.['companyId'] !== companyId) {
      throw new functions.https.HttpsError('not-found', 'Invoice not found')
    }
    const inv = invSnap.data()!

    const { accessToken, realmId } = await getValidQuickBooksAccessToken(companyId)

    const customerName = String(inv['customerName'] ?? 'Customer')
    const customerId = await findOrCreateQuickBooksCustomer(accessToken, realmId, customerName)
    const itemId      = await findOrCreateQuickBooksServiceItem(accessToken, realmId)

    const lineItems = Array.isArray(inv['lineItems']) ? inv['lineItems'] as Record<string, unknown>[] : []
    const Line = lineItems.map(li => ({
      DetailType: 'SalesItemLineDetail',
      Amount: Number(li['qty'] ?? 0) * Number(li['rate'] ?? 0),
      Description: String(li['description'] ?? ''),
      SalesItemLineDetail: { ItemRef: { value: itemId } },
    }))

    const existingQbId = inv['quickbooksInvoiceId'] ? String(inv['quickbooksInvoiceId']) : ''
    const body: Record<string, unknown> = {
      CustomerRef: { value: customerId },
      Line,
      DocNumber: String(inv['invoiceNumber'] ?? '').slice(0, 21), // QuickBooks' DocNumber max length
    }

    let result: Record<string, unknown>
    if (existingQbId) {
      const existing = await qbFetch(accessToken, realmId, `/invoice/${existingQbId}`)
      const syncToken = String((existing['Invoice'] as Record<string, unknown>)['SyncToken'] ?? '0')
      result = await qbFetch(accessToken, realmId, '/invoice', {
        method: 'POST',
        body: JSON.stringify({ ...body, Id: existingQbId, SyncToken: syncToken, sparse: true }),
      })
    } else {
      result = await qbFetch(accessToken, realmId, '/invoice', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    }

    const qbInvoice = result['Invoice'] as Record<string, unknown>
    await invSnap.ref.update({ quickbooksInvoiceId: String(qbInvoice['Id']) })

    return { quickbooksInvoiceId: String(qbInvoice['Id']) }
  })
