// Signup, company setup, invitations, custom claims, and super-admin views.

import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { db, auth, escapeHtml, makeRateLimiter, isSuperAdmin, isoOrNull, SUPER_ADMIN_EMAILS } from './common'

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

// ── Cross-company team listing (super-admin only) ───────────────────────────────
// Callable: read-only. Lists every company and its members, joined server-side via
// the Admin SDK. Never exposed to Firestore security rules — gated entirely on the
// SUPER_ADMIN_EMAILS allowlist plus a verified email, checked before any read.
interface AdminTeamMember {
  uid: string; email: string
  firstName: string; lastName: string; displayName: string
  profileImageUrl: string; role: string | null
  isOwner: boolean; isOnline: boolean
  createdAt: string | null; lastSeen: string | null
}
interface AdminTeamGroup {
  kind: 'company' | 'orphan' | 'unassigned'
  companyId: string; name: string; plan: string
  ownerUid: string; ownerEmail: string; ownerMissing: boolean
  createdAt: string | null; memberCount: number
  members: AdminTeamMember[]
}

export const adminListAllTeams = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const { uid, token } = context.auth
    if (!isSuperAdmin(token.email) || token.email_verified !== true) {
      console.warn('adminListAllTeams: denied', { uid, email: token.email })
      throw new functions.https.HttpsError('permission-denied', 'Not authorized')
    }
    checkSuperAdminRate(uid)

    const COMPANY_CAP = 500
    const USER_CAP    = 5000
    const [companySnap, userSnap] = await Promise.all([
      db.collection('companies').limit(COMPANY_CAP + 1).get(),
      db.collection('users').limit(USER_CAP + 1).get(),
    ])
    const truncated = companySnap.size > COMPANY_CAP || userSnap.size > USER_CAP
    const companyDocs = companySnap.docs.slice(0, COMPANY_CAP)
    const userDocs    = userSnap.docs.slice(0, USER_CAP)

    const groups = new Map<string, AdminTeamGroup>()
    for (const doc of companyDocs) {
      const d = doc.data()
      groups.set(doc.id, {
        kind: 'company',
        companyId: doc.id,
        name: typeof d.name === 'string' && d.name ? d.name : doc.id,
        plan: typeof d.plan === 'string' ? d.plan : '',
        ownerUid: typeof d.ownerUid === 'string' ? d.ownerUid : '',
        ownerEmail: typeof d.ownerEmail === 'string' ? d.ownerEmail : '',
        ownerMissing: false,
        createdAt: isoOrNull(d.createdAt),
        memberCount: 0,
        members: [],
      })
    }

    const UNASSIGNED_KEY = 'unassigned'

    for (const doc of userDocs) {
      const d = doc.data()
      const companyId = typeof d.companyId === 'string' && d.companyId ? d.companyId : ''
      const role = typeof d.role === 'string' ? d.role : null

      let group = companyId ? groups.get(companyId) : groups.get(UNASSIGNED_KEY)
      if (!group) {
        if (!companyId) {
          group = {
            kind: 'unassigned', companyId: '', name: 'No company assigned', plan: '',
            ownerUid: '', ownerEmail: '', ownerMissing: false,
            createdAt: null, memberCount: 0, members: [],
          }
          groups.set(UNASSIGNED_KEY, group)
        } else {
          group = {
            kind: 'orphan', companyId, name: 'Unknown company', plan: '',
            ownerUid: '', ownerEmail: '', ownerMissing: false,
            createdAt: null, memberCount: 0, members: [],
          }
          groups.set(companyId, group)
        }
      }

      const isOwner = doc.id === group.ownerUid || role === 'owner'
      group.members.push({
        uid: doc.id,
        email: typeof d.email === 'string' ? d.email : '',
        firstName: typeof d.firstName === 'string' ? d.firstName : '',
        lastName: typeof d.lastName === 'string' ? d.lastName : '',
        displayName: typeof d.displayName === 'string' ? d.displayName : '',
        profileImageUrl: (typeof d.profileImageUrl === 'string' && d.profileImageUrl)
          || (typeof d.photoURL === 'string' ? d.photoURL : ''),
        role,
        isOwner,
        isOnline: typeof d.isOnline === 'boolean' ? d.isOnline : false,
        createdAt: isoOrNull(d.createdAt),
        lastSeen: isoOrNull(d.lastSeen),
      })
      group.memberCount += 1
      if (doc.id === group.ownerUid) group.ownerMissing = false
    }

    for (const group of groups.values()) {
      if (group.kind === 'company' && group.ownerUid && !group.members.some(m => m.uid === group.ownerUid)) {
        group.ownerMissing = true
      }
    }

    const ordered = [...groups.values()].sort((a, b) => {
      const rank = (g: AdminTeamGroup) => g.kind === 'company' ? 0 : g.kind === 'orphan' ? 1 : 2
      const r = rank(a) - rank(b)
      if (r !== 0) return r
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.companyId.localeCompare(b.companyId)
    })

    console.log('adminListAllTeams: served', { uid, companies: ordered.length, members: userDocs.length })

    return {
      generatedAt: new Date().toISOString(),
      truncated,
      totals: { companies: ordered.length, members: userDocs.length },
      groups: ordered,
    }
  })

// ── Delete an orphaned company (super-admin only) ────────────────────────────────
// For companies/{id} docs whose ownerUid has no matching users/{uid} doc (account
// deleted, signup that never finished, etc.) — surfaced by adminListAllTeams as
// ownerMissing. Re-verifies server-side (rather than trusting the client's stale
// snapshot) that the company truly has zero users and zero customer records
// before deleting, so a real company can never be wiped by a race condition.
export const adminDeleteOrphanCompany = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const { uid, token } = context.auth
    if (!isSuperAdmin(token.email) || token.email_verified !== true) {
      console.warn('adminDeleteOrphanCompany: denied', { uid, email: token.email })
      throw new functions.https.HttpsError('permission-denied', 'Not authorized')
    }
    checkSuperAdminRate(uid)

    const { companyId } = data as { companyId?: string }
    if (!companyId) {
      throw new functions.https.HttpsError('invalid-argument', 'companyId is required')
    }

    const companyRef = db.collection('companies').doc(companyId)
    const companySnap = await companyRef.get()
    if (!companySnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Company not found')
    }

    const usersSnap = await db.collection('users').where('companyId', '==', companyId).limit(1).get()
    if (!usersSnap.empty) {
      throw new functions.https.HttpsError('failed-precondition', 'This company still has user records — refusing to delete')
    }
    const custSnap = await db.collection('Customers').where('companyId', '==', companyId).limit(1).get()
    if (!custSnap.empty) {
      throw new functions.https.HttpsError('failed-precondition', 'This company still has customer/lead records — refusing to delete')
    }

    await companyRef.delete()
    console.log('adminDeleteOrphanCompany: deleted', { uid, companyId })
    return { success: true }
  })

// 5 verify attempts / IP / 60 s
const checkVerifyRate = makeRateLimiter(60_000, 5)
// 10 invite attempts / uid / 60 s
const checkInviteRate = makeRateLimiter(60_000, 10)
// 6 cross-tenant listings / uid / 60 s
const checkSuperAdminRate = makeRateLimiter(60_000, 6)

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
