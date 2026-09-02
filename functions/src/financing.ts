// Consumer-financing provider integration (application creation + webhook).

import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { createHmac, timingSafeEqual } from 'crypto'
import { db, auth, assertCompanyAdmin } from './common'

// ── Consumer financing (Wisetack-style) ──────────────────────────────────────
//
// Lets a customer apply for a payment plan against the full amount of a
// proposal or invoice — a big-ticket-job feature distinct from the Stripe
// "pay now" flow above. Unlike Stripe here (one platform-wide key, money
// flows through the CRM vendor's own account), a financing payout goes to the
// *company's own* bank account, so credentials must be genuinely per-company —
// same shape as quickbooksTokens, never exposed to the client.
//
// IMPORTANT — placeholder API shape: the exact endpoint paths, field names,
// and webhook signature header below are written against the general shape
// this class of provider (Wisetack and similar) publishes, but have not been
// verified against live docs. Confirm and adjust FINANCING_API_BASE, the
// request/response field names in callFinancingApi(), and the signature
// header name in verifyFinancingSignature() before connecting a real account —
// same caveat this file already carries for the Resend inbound-email shape.
//
// Setup: set secret FINANCING_WEBHOOK_SECRET (shared secret from the provider
// dashboard for verifying inbound webhook signatures — this one IS global,
// unlike the per-company API key, since it authenticates the webhook
// endpoint itself rather than any one company's funds). Each company then
// pastes their own merchant API key via connectFinancing.

const FINANCING_API_BASE = 'https://api.wisetack.com/v1'

interface FinancingCreateResponse { id: string; applyUrl: string }

async function callFinancingApi(
  apiKey: string, sandbox: boolean, path: string, body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const base = sandbox ? `${FINANCING_API_BASE}/sandbox` : FINANCING_API_BASE
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json() as Record<string, unknown>
  if (!res.ok) {
    const message = String(json['message'] ?? json['error'] ?? `Financing API error (${res.status})`)
    throw new functions.https.HttpsError('internal', message)
  }
  return json
}

function financingCredentialsRef(companyId: string) {
  return db.collection('financingCredentials').doc(companyId)
}

function financingStatusRef(companyId: string) {
  return db.collection('companies').doc(companyId).collection('settings').doc('financingStatus')
}

export const connectFinancing = functions
  .https.onCall(async (data, context) => {
    const companyId = await assertCompanyAdmin(context)

    const apiKey       = String((data ?? {}).apiKey ?? '').trim()
    const merchantName = String((data ?? {}).merchantName ?? '').trim()
    const sandbox       = (data ?? {}).sandbox === true
    if (!apiKey) throw new functions.https.HttpsError('invalid-argument', 'apiKey is required')

    await financingCredentialsRef(companyId).set({
      apiKey, merchantName, sandbox, updatedAt: FieldValue.serverTimestamp(),
    })
    await financingStatusRef(companyId).set({
      connected: true, merchantName, sandbox, connectedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return { success: true }
  })

export const disconnectFinancing = functions
  .https.onCall(async (_data, context) => {
    const companyId = await assertCompanyAdmin(context)

    await financingCredentialsRef(companyId).delete()
    await financingStatusRef(companyId).set({ connected: false }, { merge: true })

    return { success: true }
  })

// Resolves the live source doc + its total + share token, regardless of
// whether financing was requested against a proposal or an invoice — keeps
// createFinancingApplication from needing two near-identical code paths.
async function resolveFinancingSource(
  sourceType: string, sourceId: string, companyId: string,
): Promise<{ ref: FirebaseFirestore.DocumentReference; amount: number; shareToken: string; customerName: string; customerPhone: string; customerEmail: string }> {
  const col = sourceType === 'proposal' ? 'Proposals' : 'Invoices'
  const ref = db.collection(col).doc(sourceId)
  const snap = await ref.get()
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Record not found')
  const d = snap.data()!
  if (String(d['companyId'] ?? '') !== companyId) throw new functions.https.HttpsError('not-found', 'Record not found')

  const lineItems = (Array.isArray(d['lineItems']) ? d['lineItems'] : []) as { qty?: number; rate?: number }[]
  const subtotal = lineItems.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0)
  const taxRate = Number(d['taxRate']) || 0
  const amount = subtotal + subtotal * (taxRate / 100)

  return {
    ref,
    amount,
    shareToken: String(d['shareToken'] ?? ''),
    customerName:  String(d['customerName']  ?? ''),
    customerPhone: String(d['customerPhone'] ?? ''),
    customerEmail: String(d['customerEmail'] ?? ''),
  }
}

export const createFinancingApplication = functions
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    const companyId = context.auth.token.companyId as string
    if (!companyId) throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')

    const sourceType = String((data ?? {}).sourceType ?? '')
    const sourceId   = String((data ?? {}).sourceId ?? '')
    if (sourceType !== 'proposal' && sourceType !== 'invoice') {
      throw new functions.https.HttpsError('invalid-argument', "sourceType must be 'proposal' or 'invoice'")
    }
    if (!sourceId) throw new functions.https.HttpsError('invalid-argument', 'sourceId is required')

    const credSnap = await financingCredentialsRef(companyId).get()
    if (!credSnap.exists) throw new functions.https.HttpsError('failed-precondition', 'Financing is not connected for this account')
    const { apiKey, sandbox } = credSnap.data() as { apiKey: string; sandbox: boolean }

    const source = await resolveFinancingSource(sourceType, sourceId, companyId)
    if (source.amount <= 0) throw new functions.https.HttpsError('failed-precondition', 'Amount must be greater than zero')

    // See the placeholder-shape note at the top of this section — field names
    // here (amountCents, consumer.*, applyUrl) need confirming against the
    // real provider's current create-transaction endpoint.
    const created = await callFinancingApi(apiKey, sandbox, '/transactions', {
      amountCents: Math.round(source.amount * 100),
      consumer: {
        name:  source.customerName,
        phone: source.customerPhone,
        email: source.customerEmail,
      },
      metadata: { companyId, sourceType, sourceId },
    }) as unknown as FinancingCreateResponse

    if (!created.id || !created.applyUrl) {
      throw new functions.https.HttpsError('internal', 'Financing provider did not return an application id/link')
    }

    const appRef = await db.collection('financingApplications').add({
      companyId, sourceType, sourceId,
      shareToken: source.shareToken || null,
      amount: source.amount,
      providerTransactionId: created.id,
      applyUrl: created.applyUrl,
      status: 'created',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const batch = db.batch()
    batch.update(source.ref, { financingApplicationId: appRef.id })
    if (source.shareToken) {
      const publicCol = sourceType === 'proposal' ? 'publicProposals' : 'publicInvoices'
      batch.update(db.collection(publicCol).doc(source.shareToken), {
        financingApplyUrl: created.applyUrl,
        financingStatus: 'created',
      })
    }
    await batch.commit()

    return { applicationId: appRef.id, applyUrl: created.applyUrl }
  })

// Confirm the actual header name/algorithm against the provider's current
// webhook docs — written as a generic HMAC-SHA256-over-raw-body check
// (the same shape Meta and most webhook providers use) as a starting point.
function verifyFinancingSignature(rawBody: Buffer, header: string, secret: string): boolean {
  const provided = header.startsWith('sha256=') ? header.slice(7) : header
  if (!provided) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(provided, 'hex')
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const financingWebhook = functions
  .runWith({ secrets: ['FINANCING_WEBHOOK_SECRET'] })
  .https.onRequest(async (req, res) => {
    const secret = process.env.FINANCING_WEBHOOK_SECRET ?? ''
    const signature = req.get('X-Signature') ?? req.get('Signature') ?? ''
    if (!secret || !req.rawBody || !verifyFinancingSignature(req.rawBody, signature, secret)) {
      console.error('financingWebhook: signature verification failed')
      res.status(403).send('forbidden')
      return
    }

    try {
      const body = (req.body ?? {}) as Record<string, unknown>
      const transactionId = String(body['transactionId'] ?? body['id'] ?? '')
      const status = String(body['status'] ?? '')
      if (!transactionId || !status) {
        res.status(200).send('ok')
        return
      }

      const appSnap = await db.collection('financingApplications')
        .where('providerTransactionId', '==', transactionId)
        .limit(1)
        .get()
      if (appSnap.empty) {
        console.error('financingWebhook: no application found for transaction', transactionId)
        res.status(200).send('ok')
        return
      }

      const appDoc = appSnap.docs[0]
      const app = appDoc.data()
      const sourceType = String(app['sourceType'] ?? '')
      const publicCol = sourceType === 'proposal' ? 'publicProposals' : 'publicInvoices'
      const shareToken = String(app['shareToken'] ?? '')

      // The live Proposal/Invoice doc already carries financingApplicationId
      // (set at creation) — status itself lives only on the application doc,
      // which the staff detail page subscribes to directly, so there's
      // nothing to update on the source doc here. Only the public snapshot
      // needs a mirrored copy, since it can't read financingApplications.
      const batch = db.batch()
      batch.update(appDoc.ref, { status, updatedAt: FieldValue.serverTimestamp() })
      if (shareToken) {
        batch.update(db.collection(publicCol).doc(shareToken), { financingStatus: status })
      }
      await batch.commit()
    } catch (err) {
      console.error('financingWebhook error:', err)
    }

    res.status(200).send('ok')
  })
