import * as functions from 'firebase-functions/v1'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging'

initializeApp()
const db        = getFirestore()
const auth      = getAuth()
const messaging = getMessaging()

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
  })
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

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#030712;color:#f9fafb;border-radius:12px">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 8px">You've been invited to TheLight</h1>
      <p style="font-size:14px;color:#9ca3af;margin:0 0 24px">
        <strong style="color:#f9fafb">${opts.inviterName}</strong> has invited you to join their team on TheLight CRM.
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
