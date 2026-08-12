import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()
const db = admin.firestore()
const FieldValue = admin.firestore.FieldValue

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

  await admin.auth().setCustomUserClaims(user.uid, { companyId, role })

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

  await admin.auth().setCustomUserClaims(uid, { companyId, role: 'owner' })

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
export const inviteUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
  }
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

  // If user already exists in Auth, assign claims immediately.
  // Never downgrade an existing owner of this same company.
  try {
    const existingUser = await admin.auth().getUserByEmail(email)
    const existingClaims = (await admin.auth().getUser(existingUser.uid)).customClaims ?? {}
    const alreadyOwner = existingClaims['companyId'] === companyId && existingClaims['role'] === 'owner'
    if (!alreadyOwner) {
      await admin.auth().setCustomUserClaims(existingUser.uid, { companyId, role: 'member' })
      await db.collection('users').doc(existingUser.uid).set(
        { companyId, role: 'member' },
        { merge: true }
      )
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
  await admin.auth().setCustomUserClaims(uid, { companyId, role: correctRole })
  await db.collection('users').doc(uid).set({ role: correctRole }, { merge: true })

  return { role: correctRole }
})

// ── Data migration ──────────────────────────────────────────────────────────────
// Callable (owner only): tags all untagged documents with the caller's companyId.
// Run once after your account is set up, before enabling strict Firestore rules.
export const migrateExistingData = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')
    }
    const { companyId, role } = context.auth.token
    if (!companyId) {
      throw new functions.https.HttpsError('failed-precondition', 'Run setupAccount first')
    }
    if (role !== 'owner') {
      throw new functions.https.HttpsError('permission-denied', 'Owner only')
    }

    const COLLECTIONS = ['Customers', 'Expenses', 'ToDoItems']
    let total = 0

    for (const colName of COLLECTIONS) {
      const snap = await db.collection(colName).get()
      const untagged = snap.docs.filter(d => !d.data().companyId)

      for (let i = 0; i < untagged.length; i += 500) {
        const batch = db.batch()
        for (const d of untagged.slice(i, i + 500)) {
          batch.update(d.ref, { companyId })
        }
        await batch.commit()
      }
      total += untagged.length
    }

    return { migrated: total, companyId }
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

    const payload: admin.messaging.MulticastMessage = {
      tokens: fcmTokens,
      notification: { title: senderName, body: bodyText },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      data: { fromId, toId, type: 'chat_message' },
    }

    const result = await admin.messaging().sendEachForMulticast(payload)

    // Remove tokens that FCM says are no longer valid
    const stale = fcmTokens.filter((_, i) => {
      const code = result.responses[i]?.error?.code ?? ''
      return code === 'messaging/invalid-registration-token' ||
             code === 'messaging/registration-token-not-registered'
    })
    if (stale.length > 0) {
      await db.collection('users').doc(toId).update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...stale),
      })
    }

    return null
  })
