import * as functions from 'firebase-functions/v1'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging'

initializeApp()
const db        = getFirestore()
const auth      = getAuth()
const messaging = getMessaging()

// Domain used for reply-to addresses so customer replies can be routed back
// into their thread. Requires the domain to be verified in Resend with
// inbound routing configured (MX records + Resend inbound webhook pointed
// at emailInboundWebhook) — until then, replies just won't be captured.
const INBOUND_REPLY_DOMAIN = 'mail.thelightui.com'

function replyToFor(companyId: string): string {
  return `replies+${companyId}@${INBOUND_REPLY_DOMAIN}`
}

async function logOutboundEmail(
  companyId: string, customerId: string, fromAddress: string, toAddress: string, subject: string, body: string,
): Promise<void> {
  await db.collection('emailMessages').add({
    companyId, customerId,
    direction: 'outbound',
    fromAddress, toAddress, subject, body,
    createdAt: FieldValue.serverTimestamp(),
    read: true,
  })
}

// ── New user signup ─────────────────────────────────────────────────────────────
// Creates a company (or joins one via invitation) and sets custom claims.
export const onUserCreated = functions.auth.user().onCreate(async (user) => {
  const inviteSnap = await db
    .collection('invitations')
    .where('email', '==', user.email)
    .where('status', '==', 'pending')
    .limit(1)
    .get()

  let companyId: string
  let role: 'owner' | 'member'

  if (!inviteSnap.empty) {
    const invite = inviteSnap.docs[0]
    companyId = invite.data().companyId as string
    role = 'member'
    await invite.ref.update({
      status: 'accepted',
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedByUid: user.uid,
    })
  } else {
    const ref = db.collection('companies').doc()
    companyId = ref.id
    role = 'owner'
    await ref.set({
      name: user.displayName ?? user.email ?? 'My Company',
      ownerUid: user.uid,
      ownerEmail: user.email ?? '',
      createdAt: FieldValue.serverTimestamp(),
      plan: 'free',
    })
  }

  await auth.setCustomUserClaims(user.uid, { companyId, role })

  await db.collection('users').doc(user.uid).set({
    companyId,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    photoURL: user.photoURL ?? '',
    role,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })
})

// ── Setup existing accounts ─────────────────────────────────────────────────────
// Callable: for users who existed before multi-tenancy. Creates a company for them
// and sets custom claims. Safe to call multiple times — no-ops if already set.
export const setupAccount = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
  }
  const { uid, token } = context.auth

  if (token.companyId) {
    return { companyId: token.companyId as string, role: token.role as string }
  }

  const ref = db.collection('companies').doc()
  const companyId = ref.id

  await ref.set({
    name: token.name ?? token.email ?? 'My Company',
    ownerUid: uid,
    ownerEmail: token.email ?? '',
    createdAt: FieldValue.serverTimestamp(),
    plan: 'free',
  })

  await auth.setCustomUserClaims(uid, { companyId, role: 'owner' })

  await db.collection('users').doc(uid).set({
    companyId,
    email: token.email ?? '',
    displayName: token.name ?? '',
    role: 'owner',
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { companyId, role: 'owner' }
})

// ── Invite a user ───────────────────────────────────────────────────────────────
// Callable (owner/admin only): sends an invitation by email.
// If the invitee already has an account, assigns their claims immediately.
export const inviteUser = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
  }
  checkInviteRate(context.auth.uid)
  const { companyId, role } = context.auth.token
  if (!companyId) {
    throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')
  }
  if (role !== 'owner' && role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only owners and admins can invite users')
  }

  const { email } = data as { email: string }
  if (!email || typeof email !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'A valid email is required')
  }

  // Avoid duplicate pending invites
  const existing = await db
    .collection('invitations')
    .where('email', '==', email)
    .where('companyId', '==', companyId)
    .where('status', '==', 'pending')
    .limit(1)
    .get()

  if (!existing.empty) {
    return { success: true, alreadyInvited: true }
  }

  await db.collection('invitations').add({
    email,
    companyId,
    invitedBy: context.auth.uid,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  })

  // Send invite email (no-ops gracefully if SMTP not configured)
  const inviterName = (context.auth.token.name as string | undefined)
    ?? (context.auth.token.email as string | undefined)
    ?? 'Your team'
  const registerUrl = `https://thelightui.web.app/register?email=${encodeURIComponent(email)}`
  await sendInviteEmail({ to: email, inviterName, registerUrl }).catch(err =>
    console.error('Failed to send invite email:', err)
  )

  // If user already exists in Auth, assign claims immediately.
  // Never downgrade an existing owner of this same company.
  try {
    const existingUser   = await auth.getUserByEmail(email)
    const existingClaims = (await auth.getUser(existingUser.uid)).customClaims ?? {}
    const alreadyOwner   = existingClaims['companyId'] === companyId && existingClaims['role'] === 'owner'
    if (!alreadyOwner) {
      await auth.setCustomUserClaims(existingUser.uid, { companyId, role: 'member' })
      await db.collection('users').doc(existingUser.uid).set(
        { companyId, role: 'member' },
        { merge: true }
      )
      // Signal the client to force-refresh its ID token.
      // The client watches this doc via onSnapshot; when it fires the client
      // calls getIdToken(true) and picks up the new companyId claim immediately
      // instead of waiting up to one hour for natural token expiry.
      await db.collection('claimRefreshSignals').doc(existingUser.uid).set({
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  } catch {
    // User doesn't exist yet — handled on first sign-in via onUserCreated
  }

  return { success: true, alreadyInvited: false }
})

// ── Fix role ────────────────────────────────────────────────────────────────────
// Callable: corrects a user's role claim by checking the companies document.
// If the caller is the ownerUid of their company → 'owner', else → 'member'.
export const fixRole = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
  }
  const { uid, token } = context.auth
  const companyId = token.companyId as string | undefined
  if (!companyId) {
    throw new functions.https.HttpsError('failed-precondition', 'Run setupAccount first')
  }

  const companySnap = await db.collection('companies').doc(companyId).get()
  if (!companySnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Company not found')
  }

  const correctRole: 'owner' | 'member' = companySnap.data()?.ownerUid === uid ? 'owner' : 'member'
  await auth.setCustomUserClaims(uid, { companyId, role: correctRole })
  await db.collection('users').doc(uid).set({ role: correctRole }, { merge: true })

  return { role: correctRole }
})

// ── Sync claims from Firestore user doc ─────────────────────────────────────────
// Callable: reads the user's own Firestore doc and stamps companyId + role into
// their custom claims. Used after invite redemption so the new companyId is
// immediately reflected in the token without waiting for natural expiry (~1 hr).
export const syncUserClaims = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
  }
  const { uid } = context.auth
  const snap = await db.collection('users').doc(uid).get()
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'User document not found')
  }
  const data = snap.data()!
  const companyId = typeof data.companyId === 'string' ? data.companyId : null
  const role      = typeof data.role      === 'string' ? data.role      : 'member'
  if (!companyId) {
    throw new functions.https.HttpsError('failed-precondition', 'No companyId in user document')
  }
  await auth.setCustomUserClaims(uid, { companyId, role })
  // Trigger client-side token refresh via the claimRefreshSignals listener
  await db.collection('claimRefreshSignals').doc(uid).set({ updatedAt: FieldValue.serverTimestamp() })
  return { companyId, role }
})

// ── Shared rate limiter ─────────────────────────────────────────────────────────
// Per-instance sliding-window. Good enough to block naive bulk callers without
// requiring an external store. Key is caller IP or uid depending on context.
function makeRateLimiter(windowMs: number, limit: number) {
  const bucket = new Map<string, number[]>()
  return function check(key: string): void {
    const now  = Date.now()
    const hits = (bucket.get(key) ?? []).filter(t => now - t < windowMs)
    if (hits.length >= limit) {
      throw new functions.https.HttpsError('resource-exhausted', 'Too many requests — try again later')
    }
    hits.push(now)
    bucket.set(key, hits)
  }
}

// 5 verify attempts / IP / 60 s
const checkVerifyRate = makeRateLimiter(60_000, 5)
// 10 invite attempts / uid / 60 s
const checkInviteRate = makeRateLimiter(60_000, 10)

// ── HTML escaping ────────────────────────────────────────────────────────────────
// Firebase Auth displayName and Firestore customer fields are user-controlled
// and not sanitized at the source; both flow into transactional/campaign email
// HTML bodies below. Escape before interpolating into any HTML template.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Email helper ────────────────────────────────────────────────────────────────
// Uses the Resend HTTP API. Set RESEND_API_KEY via:
//   printf 'your_key' | npx firebase-tools functions:secrets:set RESEND_API_KEY --data-file -
// Gracefully no-ops if the secret is not configured.
async function sendInviteEmail(opts: {
  to: string
  inviterName: string
  registerUrl: string
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping invite email.')
    return
  }

  const safeInviterName = escapeHtml(opts.inviterName)
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#030712;color:#f9fafb;border-radius:12px">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 8px">You've been invited to TheLight</h1>
      <p style="font-size:14px;color:#9ca3af;margin:0 0 24px">
        <strong style="color:#f9fafb">${safeInviterName}</strong> has invited you to join their team on TheLight CRM.
      </p>
      <a href="${opts.registerUrl}"
         style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none">
        Create your account →
      </a>
      <p style="font-size:12px;color:#6b7280;margin:24px 0 0">
        Sign up using the email address this invitation was sent to.<br>
        If you did not expect this invitation, you can ignore this email.
      </p>
    </div>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'TheLight CRM <onboarding@resend.dev>',
      to: [opts.to],
      subject: `${opts.inviterName} invited you to TheLight`,
      html,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API error ${res.status}: ${body}`)
  }
}

// ── reCAPTCHA v3 registration gate ─────────────────────────────────────────────
// Callable: validates a reCAPTCHA v3 token before account creation.
// Set RECAPTCHA_SECRET_KEY in Firebase Functions environment:
//   firebase functions:secrets:set RECAPTCHA_SECRET_KEY
// Gracefully allows through if the secret is not yet configured.

export const verifyRegistration = functions.https.onCall(async (data, context) => {
  const forwarded = context.rawRequest.headers['x-forwarded-for']
  const ip = (
    Array.isArray(forwarded) ? forwarded[0] : (forwarded as string | undefined)?.split(',')[0].trim()
  ) ?? context.rawRequest.ip ?? 'unknown'
  checkVerifyRate(ip)

  const { token } = data as { token?: string }
  if (!token) {
    throw new functions.https.HttpsError('invalid-argument', 'reCAPTCHA token required')
  }

  const secret = process.env.RECAPTCHA_SECRET_KEY
  if (!secret) {
    console.warn('RECAPTCHA_SECRET_KEY not set — skipping server-side verification')
    return { success: true }
  }

  const body = new URLSearchParams({ secret, response: token })
  const res  = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST', body,
  })
  const json = await res.json() as {
    success: boolean
    score: number
    action: string
    'error-codes'?: string[]
  }

  if (!json.success || json.score < 0.5) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `reCAPTCHA score too low (${json.score ?? 'unknown'})`,
    )
  }

  return { success: true, score: json.score }
})

// ── Stripe: create checkout session ────────────────────────────────────────────
// Callable: creates a Stripe Checkout session for a public invoice share link.
// Returns { url } — the client redirects there to complete payment.
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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: inv.customerEmail || undefined,
      metadata: { token, invoiceId: inv.invoiceId, companyId: inv.companyId },
      success_url: `${origin}/i/${token}?paid=1`,
      cancel_url:  `${origin}/i/${token}`,
    })

    return { url: session.url as string }
  })

// ── Stripe: webhook receiver ────────────────────────────────────────────────────
// HTTP endpoint (not callable). Register this URL in your Stripe dashboard:
//   https://us-central1-thelightui.cloudfunctions.net/stripeWebhook
// Events to listen for: checkout.session.completed
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

    res.json({ received: true })
  })

// ── AI Lead Scoring ────────────────────────────────────────────────────────────
// Callable: fetches active leads for the company, sends them to Claude API,
// and stores scores in LeadScores/{companyId}.
// Set secret: printf 'sk-ant-...' | npx firebase-tools functions:secrets:set ANTHROPIC_API_KEY --data-file -
export const scoreLeads = functions
  .runWith({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const companyId = context.auth.token.companyId as string
    if (!companyId) {
      throw new functions.https.HttpsError('failed-precondition', 'Account not set up')
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new functions.https.HttpsError('unavailable', 'ANTHROPIC_API_KEY secret not configured')
    }

    // Fetch all active records for the company, filter to leads in JS
    const snap = await db.collection('Customers')
      .where('companyId', '==', companyId)
      .limit(200)
      .get()

    const now = Date.now()
    const leads = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((r: Record<string, unknown>) =>
        r['active'] !== '0' &&
        (r['category'] as string | undefined)?.toLowerCase() === 'lead'
      )
      .slice(0, 60)  // cap at 60 to keep token usage reasonable
      .map((r: Record<string, unknown>) => {
        const created    = (r['createdAt'] as { toMillis?: () => number } | null)?.toMillis?.() ?? 0
        const followUpMs = (r['followUpDate'] as { toMillis?: () => number } | null)?.toMillis?.() ?? null
        const startMs    = (r['start'] as { toMillis?: () => number } | null)?.toMillis?.() ?? null
        return {
          id:              r['id'] as string,
          amount:          Number(r['amount']) || 0,
          hasPhone:        Boolean(r['phone']),
          hasEmail:        Boolean(r['email']),
          isContacted:     (r['callback'] as string | undefined)?.toLowerCase() === 'yes',
          hasAppointment:  startMs !== null && startMs > now,
          daysOld:         Math.floor((now - created) / 86_400_000),
          followUpOverdue: followUpMs !== null && followUpMs < now,
          followUpSoon:    followUpMs !== null && followUpMs >= now && followUpMs - now < 3 * 86_400_000,
          commentCount:    Array.isArray(r['comments']) ? (r['comments'] as unknown[]).length : 0,
          hasLocation:     Boolean(r['city'] || r['state']),
        }
      })

    if (leads.length === 0) {
      return { scored: 0, message: 'No active leads found' }
    }

    const prompt = `You are a CRM analyst for a home services company. Score each lead 1-10 for likelihood to convert to a paying customer (10 = very hot, 1 = very cold).

Key signals to weigh:
- Has appointment set → strong positive
- isContacted (called back) → positive
- followUpSoon → positive
- Has phone + email → positive
- amount > 0 → positive
- followUpOverdue → negative (missed opportunity)
- daysOld > 30 → slight negative
- commentCount > 0 → positive (engagement)

Leads:
${JSON.stringify(leads)}

Respond with ONLY valid JSON, no markdown, no explanation:
{"scores":[{"id":"...","score":7,"reason":"One concise sentence."}]}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('Anthropic API error:', res.status, text)
      throw new functions.https.HttpsError('internal', `AI API error ${res.status}`)
    }

    const json = await res.json() as { content: { type: string; text: string }[] }
    const raw  = json.content.find(c => c.type === 'text')?.text ?? ''

    let parsed: { scores: { id: string; score: number; reason: string }[] }
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('Failed to parse AI response:', raw.slice(0, 500))
      throw new functions.https.HttpsError('internal', 'AI returned invalid JSON')
    }

    const scoresMap: Record<string, { score: number; reason: string }> = {}
    for (const s of parsed.scores) {
      if (s.id && typeof s.score === 'number') {
        scoresMap[s.id] = { score: Math.min(10, Math.max(1, Math.round(s.score))), reason: s.reason ?? '' }
      }
    }

    await db.collection('LeadScores').doc(companyId).set({
      scores:      scoresMap,
      scoredAt:    FieldValue.serverTimestamp(),
      scoredCount: Object.keys(scoresMap).length,
    })

    return { scored: Object.keys(scoresMap).length }
  })

// ── Recurring invoice scheduler ────────────────────────────────────────────────
// Runs daily at 8 AM UTC. Finds invoices with recurring set and nextRecurDate in
// the past, clones them (status=sent), and advances nextRecurDate by one interval.
export const generateRecurringInvoices = functions
  .pubsub.schedule('0 8 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    const snap = await db.collection('Invoices')
      .where('recurring', 'in', ['monthly', 'quarterly', 'yearly'])
      .where('nextRecurDate', '<=', Timestamp.fromDate(now))
      .get()

    let generated = 0
    for (const invoiceDoc of snap.docs) {
      try {
        const inv = invoiceDoc.data()
        const recurInterval: string = inv['recurring']
        const issueDate = new Date()
        const dueDate   = new Date()
        dueDate.setDate(dueDate.getDate() + 30)

        // Clone the invoice without the recurring schedule
        await db.collection('Invoices').add({
          ...inv,
          invoiceNumber:   generateInvNum(),
          issueDate:       Timestamp.fromDate(issueDate),
          dueDate:         Timestamp.fromDate(dueDate),
          status:          'sent',
          recurring:       null,
          nextRecurDate:   null,
          generatedFrom:   invoiceDoc.id,
          lastGeneratedAt: null,
          createdAt:       FieldValue.serverTimestamp(),
          updatedAt:       FieldValue.serverTimestamp(),
        })

        // Advance nextRecurDate on the template
        const prevDate   = inv['nextRecurDate'].toDate() as Date
        const nextDate   = advanceByInterval(prevDate, recurInterval)

        await invoiceDoc.ref.update({
          nextRecurDate:   Timestamp.fromDate(nextDate),
          lastGeneratedAt: FieldValue.serverTimestamp(),
        })

        generated++
      } catch (err) {
        console.error(`Failed to generate recurring invoice for ${invoiceDoc.id}:`, err)
      }
    }

    console.log(`generateRecurringInvoices: ${generated} invoice(s) created`)
    return null
  })

function advanceByInterval(date: Date, interval: string): Date {
  const d = new Date(date)
  if (interval === 'monthly')   d.setMonth(d.getMonth() + 1)
  else if (interval === 'quarterly') d.setMonth(d.getMonth() + 3)
  else                          d.setFullYear(d.getFullYear() + 1)
  return d
}

function generateInvNum(): string {
  const now = new Date()
  const y   = now.getFullYear()
  const m   = String(now.getMonth() + 1).padStart(2, '0')
  const r   = Math.floor(Math.random() * 9000 + 1000)
  return `INV-${y}${m}-${r}`
}

// ── Chat push notifications ─────────────────────────────────────────────────────
// Triggers when a new message is written. Sends an FCM push to the recipient's
// registered devices. Cleans up any stale tokens that FCM rejects.
export const onNewChatMessage = functions.firestore
  .document('messages/{fromId}/{toId}/{messageId}')
  .onCreate(async (snap, context) => {
    const { fromId, toId } = context.params as { fromId: string; toId: string }
    if (fromId === toId) return null  // no self-notifications

    const message = snap.data()

    // Fetch recipient's FCM tokens
    const recipientDoc = await db.collection('users').doc(toId).get()
    if (!recipientDoc.exists) return null
    const fcmTokens: string[] = recipientDoc.data()?.fcmTokens ?? []
    if (fcmTokens.length === 0) return null

    // Sender display name for the notification title
    const senderDoc = await db.collection('users').doc(fromId).get()
    const s = senderDoc.data() ?? {}
    const senderName = [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email || 'New message'

    const bodyText: string = message.messageType === 'image' ? '📷 Photo' : (message.text ?? '')

    const payload: MulticastMessage = {
      tokens: fcmTokens,
      notification: { title: senderName, body: bodyText },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      data: { fromId, toId, type: 'chat_message' },
    }

    const result = await messaging.sendEachForMulticast(payload)

    // Remove tokens that FCM says are no longer valid
    const stale = fcmTokens.filter((_, i) => {
      const code = result.responses[i]?.error?.code ?? ''
      return code === 'messaging/invalid-registration-token' ||
             code === 'messaging/registration-token-not-registered'
    })
    if (stale.length > 0) {
      await db.collection('users').doc(toId).update({
        fcmTokens: FieldValue.arrayRemove(...stale),
      })
    }

    return null
  })

// ── Bulk email send ────────────────────────────────────────────────────────────
// Callable: sends a personalized email to each selected customer record.
// Merge tags: {first} {lastname} {city} {salesman}
// Returns { sent, skipped } — skipped = no/invalid email or API error.
export const bulkSendEmail = functions
  .runWith({ secrets: ['RESEND_API_KEY'], timeoutSeconds: 300, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const companyId = context.auth.token.companyId as string
    if (!companyId) {
      throw new functions.https.HttpsError('failed-precondition', 'Account not fully set up')
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new functions.https.HttpsError('unavailable', 'Email sending is not configured')
    }

    const { customerIds, subject, body } = data as {
      customerIds: string[]
      subject: string
      body: string
    }

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'customerIds is required')
    }
    if (!subject?.trim() || !body?.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'subject and body are required')
    }
    if (customerIds.length > 500) {
      throw new functions.https.HttpsError('invalid-argument', 'Maximum 500 recipients per send')
    }

    // Fetch customers in batches of 30 (Firestore 'in' operator limit)
    const allDocs: Record<string, unknown>[] = []
    for (let i = 0; i < customerIds.length; i += 30) {
      const batch = customerIds.slice(i, i + 30)
      const snap = await db.collection('Customers')
        .where('__name__', 'in', batch)
        .where('companyId', '==', companyId)
        .get()
      snap.docs.forEach(d => allDocs.push({ id: d.id, ...d.data() }))
    }

    let sent = 0
    let skipped = 0

    for (const cust of allDocs) {
      const email = (cust['email'] as string | undefined)?.trim()
      if (!email || !email.includes('@')) { skipped++; continue }

      const first    = (cust['first']    as string) || ''
      const lastname = (cust['lastname'] as string) || ''
      const city     = (cust['city']     as string) || ''
      const salesman = (cust['salesman'] as string) || ''

      function merge(s: string): string {
        return s
          .replace(/\{first\}/gi,    first)
          .replace(/\{lastname\}/gi, lastname)
          .replace(/\{city\}/gi,     city)
          .replace(/\{salesman\}/gi, salesman)
      }

      const personalizedSubject = merge(subject)
      const personalizedBody    = merge(body)
      // personalizedBody is composed from a plain-text textarea plus
      // Firestore customer fields (first/lastname/city/salesman), neither of
      // which is meant to be interpreted as HTML — escape before wrapping in
      // <p> tags so a customer record containing e.g. "<img onerror=...>"
      // can't inject markup into the outgoing email.
      const escapedBody = escapeHtml(personalizedBody)
      const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1f2937;line-height:1.6">
        ${escapedBody.split('\n').map(p => p.trim() ? `<p style="margin:0 0 16px">${p}</p>` : '').join('')}
      </div>`

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'TheLight CRM <onboarding@resend.dev>',
            reply_to: replyToFor(companyId),
            to: [email],
            subject: personalizedSubject,
            html,
          }),
        })
        if (res.ok) {
          sent++
          await logOutboundEmail(companyId, String(cust.id), 'onboarding@resend.dev', email, personalizedSubject, personalizedBody)
        } else {
          const errText = await res.text()
          console.error(`Email to ${email} failed ${res.status}:`, errText)
          skipped++
        }
      } catch (err) {
        console.error(`Email to ${email} threw:`, err)
        skipped++
      }

      // Pause briefly every 10 sends to stay within Resend rate limits
      if (sent > 0 && sent % 10 === 0) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    return { sent, skipped }
  })

// ── Sequence runner ────────────────────────────────────────────────────────────
// Runs daily at 9 AM ET. For each active enrollment whose nextRunAt has passed,
// executes the current step (add note or set follow-up), then advances or completes.
export const runSequences = functions.pubsub
  .schedule('0 9 * * *').timeZone('America/New_York')
  .onRun(async () => {
    const now = Timestamp.now()

    const enrollmentsSnap = await db.collection('sequenceEnrollments')
      .where('status', '==', 'active')
      .where('nextRunAt', '<=', now)
      .get()

    if (enrollmentsSnap.empty) return null

    for (const enrollDoc of enrollmentsSnap.docs) {
      try {
        const enr = enrollDoc.data()
        const seqSnap = await db.collection('sequences').doc(enr.sequenceId as string).get()
        if (!seqSnap.exists) { await enrollDoc.ref.update({ status: 'cancelled' }); continue }

        const steps = (seqSnap.data()!.steps ?? []) as Array<{ delayDays: number; action: string; message: string }>
        const stepIdx = (enr.nextStepIdx as number) ?? 0

        if (stepIdx >= steps.length) {
          await enrollDoc.ref.update({ status: 'completed' }); continue
        }

        const step = steps[stepIdx]
        const customerId = enr.customerId as string
        const startedAt  = (enr.startedAt as Timestamp).toDate()

        // Execute step
        if (step.action === 'note') {
          const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          const noteEntry = `--- [${dateStr}] ---\n[Sequence: ${seqSnap.data()!.name}] ${step.message}`
          const customerDoc = await db.collection('Customers').doc(customerId).get()
          if (customerDoc.exists) {
            const existing = (customerDoc.data()!.comments as string) ?? ''
            const merged = existing.trim() ? `${noteEntry}\n\n${existing}` : noteEntry
            await db.collection('Customers').doc(customerId).update({ comments: merged, lastUpdate: Timestamp.now() })
          }
        } else if (step.action === 'followup') {
          await db.collection('Customers').doc(customerId).update({
            followUpDate: Timestamp.now(),
            lastUpdate:   Timestamp.now(),
          })
        }

        // Advance
        const completedStepIndices = [...((enr.completedStepIndices as number[]) ?? []), stepIdx]
        const nextIdx = stepIdx + 1

        if (nextIdx >= steps.length) {
          await enrollDoc.ref.update({ status: 'completed', completedStepIndices, nextStepIdx: nextIdx })
        } else {
          const nextStep = steps[nextIdx]
          const nextRunAt = new Date(startedAt.getTime() + nextStep.delayDays * 86_400_000)
          await enrollDoc.ref.update({
            nextStepIdx: nextIdx,
            nextRunAt:   Timestamp.fromDate(nextRunAt),
            completedStepIndices,
          })
        }
      } catch (err) {
        console.error('runSequences error for enrollment', enrollDoc.id, err)
      }
    }
    return null
  })

// ── Automation Rules engine ─────────────────────────────────────────────────────
// If/Then triggers authored in the `automationRules` collection. When a watched
// field on a Customer or Invoice document changes (optionally to a specific
// value), runs the rule's actions: set another field, add a note, set a
// follow-up date, or send an email. Fires are recorded in `automationLog`.

type AutomationEntityType = 'customer' | 'invoice'

interface AutomationTrigger {
  entityType: AutomationEntityType
  field: string
  type: 'changes_to' | 'any_change'
  value: string
}

interface AutomationAction {
  type: 'set_field' | 'add_note' | 'set_followup_days' | 'send_email'
  field?: string
  value?: string
  text?: string
  days?: number
  subject?: string
  body?: string
}

interface AutomationRuleDoc {
  companyId: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  actions: AutomationAction[]
}

// Fields an automation is allowed to read a trigger from or write via set_field.
// Kept server-side (not client-supplied) so a rule document can never be used to
// overwrite protected fields like companyId.
const AUTOMATION_FIELD_ALLOW: Record<AutomationEntityType, string[]> = {
  customer: ['category', 'leadStatus', 'employeeStatus', 'paymentStatus', 'salesman', 'callback'],
  invoice:  ['status'],
}

function automationMerge(s: string, ctx: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, key) => ctx[key.toLowerCase()] ?? m)
}

async function sendAutomationEmail(
  apiKey: string, companyId: string, customerId: string, to: string, subject: string, body: string,
): Promise<void> {
  if (!to.includes('@')) return
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1f2937;line-height:1.6">
    ${body.split('\n').map(p => p.trim() ? `<p style="margin:0 0 16px">${p}</p>` : '').join('')}
  </div>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TheLight CRM <onboarding@resend.dev>',
        reply_to: replyToFor(companyId),
        to: [to], subject, html,
      }),
    })
    if (res.ok) {
      await logOutboundEmail(companyId, customerId, 'onboarding@resend.dev', to, subject, body)
    } else {
      console.error(`Automation email to ${to} failed ${res.status}:`, await res.text())
    }
  } catch (err) {
    console.error(`Automation email to ${to} threw:`, err)
  }
}

async function runAutomationsFor(
  entityType: AutomationEntityType,
  collectionName: string,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  const companyId = after['companyId'] as string | undefined
  if (!companyId) return

  const rulesSnap = await db.collection('automationRules')
    .where('companyId', '==', companyId)
    .where('enabled', '==', true)
    .get()

  if (rulesSnap.empty) return

  const allowedFields = new Set(AUTOMATION_FIELD_ALLOW[entityType])
  const apiKey = process.env.RESEND_API_KEY

  for (const ruleDoc of rulesSnap.docs) {
    const rule = ruleDoc.data() as AutomationRuleDoc
    const trigger = rule.trigger
    if (!trigger || trigger.entityType !== entityType || !allowedFields.has(trigger.field)) continue

    const beforeVal = String(before[trigger.field] ?? '')
    const afterVal  = String(after[trigger.field]  ?? '')
    if (beforeVal === afterVal) continue // trigger field didn't change on this write

    const fired = trigger.type === 'any_change' ? true : afterVal === trigger.value
    if (!fired) continue

    const updates: Record<string, unknown> = {}
    const summaries: string[] = []

    const first    = String(after['first']    ?? '')
    const lastname = String(after['lastname'] ?? '')
    const email    = String(after['email'] ?? after['customerEmail'] ?? '')
    const mergeCtx: Record<string, string> = {
      first, lastname,
      city:     String(after['city']     ?? ''),
      salesman: String(after['salesman'] ?? ''),
    }

    for (const action of rule.actions ?? []) {
      try {
        if (action.type === 'set_field' && action.field
            && action.field !== trigger.field
            && allowedFields.has(action.field)) {
          updates[action.field] = action.value ?? ''
          summaries.push(`set ${action.field}="${action.value ?? ''}"`)
        } else if (action.type === 'add_note' && entityType === 'customer') {
          const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          const noteEntry = `--- [${dateStr}] ---\n[Automation: ${rule.name}] ${action.text ?? ''}`
          const existing = String(after['comments'] ?? '')
          updates['comments'] = existing.trim() ? `${noteEntry}\n\n${existing}` : noteEntry
          summaries.push('added note')
        } else if (action.type === 'set_followup_days' && entityType === 'customer') {
          const due = new Date()
          due.setDate(due.getDate() + (action.days ?? 0))
          updates['followUpDate'] = Timestamp.fromDate(due)
          summaries.push(`follow-up in ${action.days ?? 0}d`)
        } else if (action.type === 'send_email' && apiKey && email) {
          const customerId = entityType === 'customer' ? entityId : String(after['customerId'] ?? '')
          await sendAutomationEmail(
            apiKey,
            companyId,
            customerId,
            email,
            automationMerge(action.subject ?? '', mergeCtx),
            automationMerge(action.body    ?? '', mergeCtx),
          )
          summaries.push(`emailed ${email}`)
        }
      } catch (err) {
        console.error(`Automation action failed for rule ${ruleDoc.id}:`, err)
      }
    }

    if (Object.keys(updates).length > 0) {
      updates['lastUpdate'] = Timestamp.now()
      await db.collection(collectionName).doc(entityId).update(updates)
    }

    await ruleDoc.ref.update({
      runCount:  FieldValue.increment(1),
      lastRunAt: FieldValue.serverTimestamp(),
    })

    const entityLabel = entityType === 'customer'
      ? ([first, lastname].filter(Boolean).join(' ') || entityId)
      : String(after['invoiceNumber'] ?? entityId)

    await db.collection('automationLog').add({
      companyId,
      ruleId:   ruleDoc.id,
      ruleName: rule.name,
      entityType,
      entityId,
      entityLabel,
      actionsSummary: summaries.join('; ') || 'no matching actions',
      ranAt: FieldValue.serverTimestamp(),
    })
  }
}

export const onCustomerAutomation = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .firestore.document('Customers/{id}')
  .onUpdate(async (change, context) => {
    const id = context.params.id as string
    await runAutomationsFor('customer', 'Customers', id, change.before.data() ?? {}, change.after.data() ?? {})
    return null
  })

export const onInvoiceAutomation = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .firestore.document('Invoices/{id}')
  .onUpdate(async (change, context) => {
    const id = context.params.id as string
    await runAutomationsFor('invoice', 'Invoices', id, change.before.data() ?? {}, change.after.data() ?? {})
    return null
  })

// ── Inbound email webhook ────────────────────────────────────────────────────────
// Two-way email sync: outbound sends (bulkSendEmail, automation send_email) set
// reply_to to replies+<companyId>@INBOUND_REPLY_DOMAIN. When a customer replies,
// Resend's inbound email routing (once the domain is verified and inbound MX +
// webhook are configured in the Resend dashboard) POSTs the message here. The
// companyId is recovered from the "+tag" on the To address; the sender's email
// is matched against Customers to link the reply to a thread.
//
// NOTE: this handler parses a best-guess shape for the inbound payload (Resend's
// inbound email webhook is still evolving) — check functions logs after the first
// real webhook fires and adjust field names below if they don't line up.
export const emailInboundWebhook = functions
  .https.onRequest(async (req, res) => {
    try {
      const payload = (req.body?.data ?? req.body ?? {}) as Record<string, unknown>

      const toRaw = payload['to']
      const toAddress = Array.isArray(toRaw) ? String(toRaw[0]) : String(toRaw ?? payload['to_address'] ?? '')
      const fromRaw = payload['from']
      const fromAddress = (typeof fromRaw === 'object' && fromRaw)
        ? String((fromRaw as Record<string, unknown>)['email'] ?? '')
        : String(fromRaw ?? payload['from_address'] ?? '')
      const subject = String(payload['subject'] ?? '')
      const body = String(payload['text'] ?? payload['html'] ?? payload['body'] ?? '')

      const tagMatch = toAddress.match(/\+([^@]+)@/)
      const companyId = tagMatch ? tagMatch[1] : ''

      if (!companyId || !fromAddress.includes('@')) {
        console.error('emailInboundWebhook: could not determine companyId or sender', { toAddress, fromAddress })
        res.status(200).send('ignored')
        return
      }

      const custSnap = await db.collection('Customers')
        .where('companyId', '==', companyId)
        .where('email', '==', fromAddress)
        .limit(1)
        .get()
      const customerId = custSnap.empty ? '' : custSnap.docs[0].id

      await db.collection('emailMessages').add({
        companyId,
        customerId,
        direction: 'inbound',
        fromAddress,
        toAddress,
        subject,
        body,
        createdAt: FieldValue.serverTimestamp(),
        read: false,
      })

      res.status(200).send('ok')
    } catch (err) {
      console.error('emailInboundWebhook error:', err)
      res.status(500).send('error')
    }
  })
