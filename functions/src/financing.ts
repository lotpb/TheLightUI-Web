// Consumer-financing provider integration (application creation + webhook).

import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { createHmac, timingSafeEqual } from 'crypto'
import { db, auth, assertCompanyAdmin } from './common'
import { notifyCompany } from './webhookDispatch'

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

// Separate hosts, not a path segment. This was `${FINANCING_API_BASE}/sandbox`
// — https://api.wisetack.com/v1/sandbox — and providers in this class publish
// test mode on its own host, so the sandbox checkbox that defaults to on
// almost certainly pointed at a 404. Both values are part of the unverified
// shape above: confirm them before connecting a live account.
const FINANCING_API_BASE     = 'https://api.wisetack.com/v1'
const FINANCING_SANDBOX_BASE = 'https://api-sandbox.wisetack.com/v1'

function apiBase(sandbox: boolean): string {
  return sandbox ? FINANCING_SANDBOX_BASE : FINANCING_API_BASE
}

interface FinancingCreateResponse { id: string; applyUrl: string }

async function callFinancingApi(
  apiKey: string, sandbox: boolean, path: string, body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiBase(sandbox)}${path}`, {
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

/** Last four characters, so the UI can say which key is stored. */
function keyTail(apiKey: string): string {
  return apiKey.length <= 4 ? apiKey : apiKey.slice(-4)
}

interface VerifyResult {
  verified: boolean
  /**
   * True when the provider actively rejected the credential, false when the
   * call itself couldn't be completed.
   *
   * The distinction matters because the endpoint shape above is unverified: a
   * 404 means "this path is wrong", not "this key is bad", and treating the
   * two the same would throw away a perfectly good key.
   */
  definitive: boolean
  message: string
}

/**
 * Asks the provider whether the key works, before anything claims it does.
 *
 * connectFinancing used to check only that the field was non-empty, then
 * write `connected: true`. So a typo, a revoked key, or a live key pasted
 * with Sandbox ticked all produced a green "Connected" — and the first thing
 * to actually talk to the provider was createFinancingApplication, i.e. a
 * salesperson mid-conversation with a customer.
 */
async function verifyFinancingKey(apiKey: string, sandbox: boolean): Promise<VerifyResult> {
  let res: Response
  try {
    res = await fetch(`${apiBase(sandbox)}/merchants/me`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
  } catch (err) {
    console.error('verifyFinancingKey: request failed', err)
    return {
      verified: false, definitive: false,
      message: `Could not reach ${apiBase(sandbox)} — check network access, or the API base if this integration has not been confirmed against the provider's live docs yet.`,
    }
  }

  if (res.ok) return { verified: true, definitive: true, message: '' }

  if (res.status === 401 || res.status === 403) {
    return {
      verified: false, definitive: true,
      message: sandbox
        ? 'The provider rejected this key in sandbox mode. Check that it is a test key, not a live one.'
        : 'The provider rejected this key in live mode. Check that it is a live key, not a test one.',
    }
  }

  return {
    verified: false, definitive: false,
    message: `Verification endpoint returned ${res.status}. The key was saved but not confirmed — the request shape for this provider has not been verified against live docs.`,
  }
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

    const check = await verifyFinancingKey(apiKey, sandbox)

    // A key the provider actively rejected is not stored at all — storing it
    // would leave the account in a state that reads as configured and can
    // never work.
    if (!check.verified && check.definitive) {
      throw new functions.https.HttpsError('invalid-argument', check.message)
    }

    await financingCredentialsRef(companyId).set({
      apiKey, merchantName, sandbox, updatedAt: FieldValue.serverTimestamp(),
    })
    await financingStatusRef(companyId).set({
      connected: true,
      merchantName,
      sandbox,
      keyTail: keyTail(apiKey),
      verified: check.verified,
      verificationError: check.verified ? null : check.message,
      verifiedAt: check.verified ? FieldValue.serverTimestamp() : null,
      connectedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return { success: true, verified: check.verified, message: check.message }
  })

/**
 * Re-checks the stored key without disconnecting.
 *
 * There was no way to ask "does this still work?" — a key revoked at the
 * provider went on showing a green Connected until someone tried to use it.
 */
export const verifyFinancingConnection = functions
  .https.onCall(async (_data, context) => {
    const companyId = await assertCompanyAdmin(context)

    const credSnap = await financingCredentialsRef(companyId).get()
    if (!credSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Financing is not connected')
    }
    const { apiKey, sandbox } = credSnap.data() as { apiKey: string; sandbox: boolean }

    const check = await verifyFinancingKey(apiKey, sandbox === true)
    await financingStatusRef(companyId).set({
      verified: check.verified,
      verificationError: check.verified ? null : check.message,
      verifiedAt: check.verified ? FieldValue.serverTimestamp() : null,
    }, { merge: true })

    return { verified: check.verified, message: check.message }
  })

/**
 * Switches between sandbox and live on the stored credential.
 *
 * `sandbox` was write-once: changing it meant Disconnect — which deletes the
 * only copy of the key — then fetching it from the provider dashboard again
 * and re-pasting. The key is usually the same in both modes for this class of
 * provider, so the mode is re-verified rather than assumed.
 */
export const updateFinancingMode = functions
  .https.onCall(async (data, context) => {
    const companyId = await assertCompanyAdmin(context)
    const sandbox = (data ?? {}).sandbox === true

    const credSnap = await financingCredentialsRef(companyId).get()
    if (!credSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Financing is not connected')
    }
    const { apiKey } = credSnap.data() as { apiKey: string }

    const check = await verifyFinancingKey(apiKey, sandbox)
    if (!check.verified && check.definitive) {
      // The mode isn't changed, so the working configuration survives.
      throw new functions.https.HttpsError('invalid-argument', check.message)
    }

    await financingCredentialsRef(companyId).set(
      { sandbox, updatedAt: FieldValue.serverTimestamp() }, { merge: true },
    )
    await financingStatusRef(companyId).set({
      sandbox,
      verified: check.verified,
      verificationError: check.verified ? null : check.message,
      verifiedAt: check.verified ? FieldValue.serverTimestamp() : null,
    }, { merge: true })

    return { success: true, verified: check.verified, message: check.message }
  })

export const disconnectFinancing = functions
  .https.onCall(async (_data, context) => {
    const companyId = await assertCompanyAdmin(context)

    await financingCredentialsRef(companyId).delete()
    await financingStatusRef(companyId).set({
      connected: false,
      keyTail: null,
      verified: false,
      verificationError: null,
      verifiedAt: null,
    }, { merge: true })

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
      // Denormalised so the /financing list can name who applied without
      // reading every Proposal and Invoice the applications point at.
      customerName: source.customerName,
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

      // An approval or a decline used to arrive in silence: the status landed
      // on a document no page listed, so staff found out only if they happened
      // to reopen that one proposal.
      const previous = String(app['status'] ?? '')
      const companyId = String(app['companyId'] ?? '')
      if (companyId && status !== previous) {
        const who = String(app['customerName'] ?? '').trim() || 'A customer'
        const amount = Number(app['amount']) || 0
        const money = amount > 0
          ? ` for $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : ''
        await notifyCompany(
          companyId,
          'financing.statusChanged',
          `Financing ${status}`,
          `${who}'s payment-plan application${money} is now ${status}.`,
          '/financing',
        )
      }
    } catch (err) {
      console.error('financingWebhook error:', err)
    }

    res.status(200).send('ok')
  })
