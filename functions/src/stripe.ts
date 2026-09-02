// Stripe Checkout for platform billing, plus Stripe Connect onboarding so a
// company is paid into its own account.

import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'crypto'
import { db, assertCompanyAdmin } from './common'

function stripeConnectAccountRef(companyId: string) {
  return db.collection('stripeConnectAccounts').doc(companyId)
}

function stripeConnectStatusRef(companyId: string) {
  return db.collection('companies').doc(companyId).collection('settings').doc('stripeConnectStatus')
}

// ── Stripe: create checkout session ────────────────────────────────────────────
// Callable: creates a Stripe Checkout session for a public invoice share link.
// Returns { url } — the client redirects there to complete payment.
//
// If the invoice's company has connected their own Stripe account (see
// stripeConnectStart/Callback below), the session is created *for* that
// account via the stripeAccount option, so the payment lands directly in the
// company's own bank account instead of the platform's. A company that
// hasn't connected gets byte-for-byte the same behavior as before this was
// added — this fallback is what makes the change safe to ship without
// breaking any company currently relying on the platform-wide key.
export const createStripeCheckout = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https.onCall(async (data, _context) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe')
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY)

    const { token } = data as { token: string }
    if (!token) throw new functions.https.HttpsError('invalid-argument', 'token required')

    const snap = await db.collection('publicInvoices').doc(token).get()
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Invoice not found')
    const inv = snap.data()!

    if (inv.status === 'paid') {
      throw new functions.https.HttpsError('failed-precondition', 'This invoice has already been paid.')
    }

    const origin = 'https://thelightui.web.app'

    const lineItems = (inv.lineItems as { description: string; qty: number; rate: number }[]).map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.description || 'Service' },
        unit_amount: Math.round(item.rate * 100),
      },
      quantity: item.qty,
    }))

    // Add tax as a separate line item if applicable
    if (inv.taxRate > 0) {
      const subtotal = (inv.lineItems as { qty: number; rate: number }[]).reduce((s, l) => s + l.qty * l.rate, 0)
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Tax (${inv.taxRate}%)` },
          unit_amount: Math.round(subtotal * (inv.taxRate / 100) * 100),
        },
        quantity: 1,
      })
    }

    const sessionParams = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: inv.customerEmail || undefined,
      metadata: { token, invoiceId: inv.invoiceId, companyId: inv.companyId },
      success_url: `${origin}/i/${token}?paid=1`,
      cancel_url:  `${origin}/i/${token}`,
    }

    const connectSnap = inv.companyId ? await stripeConnectAccountRef(String(inv.companyId)).get() : null
    const connectedAccountId = connectSnap?.exists ? String(connectSnap.data()?.['accountId'] ?? '') : ''

    const session = connectedAccountId
      ? await stripe.checkout.sessions.create(sessionParams, { stripeAccount: connectedAccountId })
      : await stripe.checkout.sessions.create(sessionParams)

    return { url: session.url as string }
  })

// Shared by stripeWebhook (platform-account events) and stripeConnectWebhook
// (connected-account events) so the payment-completion write only exists once.
async function handleCheckoutSessionCompleted(
  event: { data: { object: { metadata?: { token?: string; invoiceId?: string } } } },
): Promise<void> {
  const { token, invoiceId } = event.data.object.metadata ?? {}
  const batch = db.batch()
  if (token) {
    batch.update(db.collection('publicInvoices').doc(token), { status: 'paid' })
  }
  if (invoiceId) {
    batch.update(db.collection('Invoices').doc(invoiceId), {
      status: 'paid',
      paidAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
}

// ── Stripe: webhook receiver (platform account) ─────────────────────────────────
// HTTP endpoint (not callable). Register this URL in your Stripe dashboard:
//   https://us-central1-thelightui.cloudfunctions.net/stripeWebhook
// Events to listen for: checkout.session.completed
//
// This endpoint only ever receives events for Checkout Sessions created
// against the platform's own account (i.e. companies that haven't connected
// Stripe). Sessions created for a connected account fire their events to
// stripeConnectWebhook below instead — see that function's comment for why
// this can't be the same endpoint.
export const stripeWebhook = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] })
  .https.onRequest(async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe')
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY)

    const sig = req.headers['stripe-signature']
    let event: { type: string; data: { object: { metadata?: { token?: string; invoiceId?: string } } } }

    try {
      event = stripe.webhooks.constructEvent(
        (req as unknown as { rawBody: Buffer }).rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      )
    } catch (err) {
      console.error('Stripe webhook signature error:', err)
      res.status(400).send(`Webhook Error: ${(err as Error).message}`)
      return
    }

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutSessionCompleted(event)
    }

    res.json({ received: true })
  })

// ── Stripe Connect ────────────────────────────────────────────────────────────
//
// Lets each company connect their own Standard Stripe account so
// createStripeCheckout pays out directly to them instead of the platform.
// OAuth shape mirrors quickbooksConnect/quickbooksOAuthCallback/
// quickbooksDisconnect above almost exactly — the one difference is that
// Stripe's token exchange is authenticated with the *platform's own* secret
// key (STRIPE_SECRET_KEY) rather than a separate client secret.
//
// Setup: create a Connect platform at https://dashboard.stripe.com/connect,
// set its OAuth redirect URI to
// https://us-central1-thelightui.cloudfunctions.net/stripeConnectCallback,
// and set secret STRIPE_CONNECT_CLIENT_ID (the "ca_..." Connect client id,
// found on the Connect settings page — not itself sensitive, but kept as a
// secret for consistency with how every other provider id is stored here).
//
// IMPORTANT: Stripe only delivers events for a *connected* account's
// Checkout Sessions to a webhook endpoint you've separately registered with
// "Listen to events on Connected accounts" checked in the dashboard, and
// that endpoint has its own signing secret. Reusing STRIPE_WEBHOOK_SECRET for
// those events will fail signature verification — that's why
// stripeConnectWebhook below is a distinct function with its own secret,
// not a branch inside stripeWebhook.

const STRIPE_CONNECT_REDIRECT_URI = 'https://us-central1-thelightui.cloudfunctions.net/stripeConnectCallback'

export const stripeConnectStart = functions
  .runWith({ secrets: ['STRIPE_CONNECT_CLIENT_ID'] })
  .https.onCall(async (_data, context) => {
    const companyId = await assertCompanyAdmin(context)

    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID
    if (!clientId) throw new functions.https.HttpsError('unavailable', 'Stripe Connect is not configured')

    const state = randomUUID()
    await db.collection('oauthStates').doc(state).set({
      companyId, provider: 'stripeConnect', createdAt: FieldValue.serverTimestamp(),
    })

    const url = 'https://connect.stripe.com/oauth/authorize?' + new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_write',
      redirect_uri: STRIPE_CONNECT_REDIRECT_URI,
      state,
    }).toString()

    return { url }
  })

export const stripeConnectCallback = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY'] })
  .https.onRequest(async (req, res) => {
    const { code, state } = req.query as Record<string, string>
    try {
      if (!code || !state) throw new Error('Missing code/state')

      const stateSnap = await db.collection('oauthStates').doc(state).get()
      if (!stateSnap.exists) throw new Error('Invalid or expired state')
      const stateData = stateSnap.data() ?? {}
      const companyId = String(stateData['companyId'] ?? '')
      await stateSnap.ref.delete()
      if (!companyId) throw new Error('No company on state')
      if (String(stateData['provider'] ?? '') !== 'stripeConnect') throw new Error('State was not issued for Stripe Connect')

      const tokenRes = await fetch('https://connect.stripe.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_secret: process.env.STRIPE_SECRET_KEY!,
          code,
          grant_type: 'authorization_code',
        }).toString(),
      })
      const tokenJson = await tokenRes.json() as Record<string, unknown>
      if (!tokenRes.ok) throw new Error(String(tokenJson['error_description'] ?? 'Stripe token exchange failed'))

      const accountId = String(tokenJson['stripe_user_id'] ?? '')
      if (!accountId) throw new Error('Stripe did not return a connected account id')

      await stripeConnectAccountRef(companyId).set({
        accountId,
        scope: String(tokenJson['scope'] ?? ''),
        connectedAt: FieldValue.serverTimestamp(),
      })
      await stripeConnectStatusRef(companyId).set({
        connected: true, accountId, connectedAt: FieldValue.serverTimestamp(),
      }, { merge: true })

      res.redirect(302, 'https://thelightui.web.app/stripe-connect?connected=1')
    } catch (err) {
      console.error('stripeConnectCallback error:', err)
      res.redirect(302, 'https://thelightui.web.app/stripe-connect?connected=0')
    }
  })

export const stripeConnectDisconnect = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_CONNECT_CLIENT_ID'] })
  .https.onCall(async (_data, context) => {
    const companyId = await assertCompanyAdmin(context)

    const accountRef = stripeConnectAccountRef(companyId)
    const accountSnap = await accountRef.get()
    const accountId = String(accountSnap.data()?.['accountId'] ?? '')
    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID

    if (accountId && clientId) {
      try {
        await fetch('https://connect.stripe.com/oauth/deauthorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            stripe_user_id: accountId,
          }).toString(),
        })
      } catch (err) {
        console.error('stripeConnectDisconnect: deauthorize failed (clearing local connection anyway):', err)
      }
    }

    await accountRef.delete()
    await stripeConnectStatusRef(companyId).set({ connected: false }, { merge: true })

    return { success: true }
  })

// ── Stripe: webhook receiver (connected accounts) ───────────────────────────────
// HTTP endpoint (not callable). Register this URL as a SECOND, separate
// webhook endpoint in your Stripe dashboard — "Listen to events on Connected
// accounts" must be checked when adding it, which is what makes Stripe use
// its own signing secret (STRIPE_CONNECT_WEBHOOK_SECRET) for events delivered
// here, distinct from stripeWebhook's STRIPE_WEBHOOK_SECRET.
export const stripeConnectWebhook = functions
  .runWith({ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_CONNECT_WEBHOOK_SECRET'] })
  .https.onRequest(async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Stripe = require('stripe')
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY)

    const sig = req.headers['stripe-signature']
    let event: { type: string; data: { object: { metadata?: { token?: string; invoiceId?: string } } } }

    try {
      event = stripe.webhooks.constructEvent(
        (req as unknown as { rawBody: Buffer }).rawBody,
        sig,
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
      )
    } catch (err) {
      console.error('Stripe Connect webhook signature error:', err)
      res.status(400).send(`Webhook Error: ${(err as Error).message}`)
      return
    }

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutSessionCompleted(event)
    }

    res.json({ received: true })
  })
