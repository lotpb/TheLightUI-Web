import {
  doc, setDoc, getDoc, updateDoc, serverTimestamp, Timestamp,
  collection, query, where, orderBy, onSnapshot,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface InviteDoc {
  companyId: string
  role: string
  createdBy: string
  createdAt: Timestamp
  expiresAt: Timestamp
  used: boolean
  usedBy?: string
  usedByEmail?: string
  usedByName?: string
  usedAt?: Timestamp
  /** Cancelled before anyone used it. Distinct from `used`. */
  revoked?: boolean
  revokedAt?: Timestamp
}

export interface InviteRecord extends InviteDoc {
  code: string
}

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes).map(b => b.toString(36)).join('').toUpperCase().substring(0, 8)
}

// A malformed/legacy doc falls back to an already-expired Timestamp rather
// than a valid-forever one, so `redeemInvite`'s expiry check fails safe.
const EPOCH = Timestamp.fromDate(new Date(0))

function parseInviteDoc(d: Record<string, unknown>): InviteDoc {
  return {
    companyId:   typeof d.companyId   === 'string' ? d.companyId   : '',
    role:        typeof d.role        === 'string' ? d.role        : 'member',
    createdBy:   typeof d.createdBy   === 'string' ? d.createdBy   : '',
    createdAt:   d.createdAt instanceof Timestamp ? d.createdAt : EPOCH,
    expiresAt:   d.expiresAt instanceof Timestamp ? d.expiresAt : EPOCH,
    used:        typeof d.used        === 'boolean' ? d.used : true,
    usedBy:      typeof d.usedBy      === 'string' ? d.usedBy      : undefined,
    usedByEmail: typeof d.usedByEmail === 'string' ? d.usedByEmail : undefined,
    usedByName:  typeof d.usedByName  === 'string' ? d.usedByName  : undefined,
    usedAt:      d.usedAt instanceof Timestamp ? d.usedAt : undefined,
    revoked:     typeof d.revoked === 'boolean' ? d.revoked : false,
    revokedAt:   d.revokedAt instanceof Timestamp ? d.revokedAt : undefined,
  }
}

/**
 * A link is only as good as the ability to take it back.
 *
 * There was no revoke of any kind: a link pasted into the wrong channel stayed
 * live for its full seven days, and the only alternative was editing Firestore
 * by hand. Kept as a flag rather than a delete because the history is the
 * record of who was invited and what happened to it.
 */
export async function revokeInvite(code: string): Promise<void> {
  await updateDoc(doc(db, 'invites', code), {
    revoked: true,
    revokedAt: serverTimestamp(),
  })
}

export async function createInvite(role: string, createdBy: string): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const code = generateCode()
  const expires = new Date()
  expires.setDate(expires.getDate() + 7)
  await setDoc(doc(db, 'invites', code), {
    companyId,
    role,
    createdBy,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expires),
    used: false,
  })
  return `${window.location.origin}/join?code=${code}`
}

export async function getInvite(code: string): Promise<InviteDoc | null> {
  const snap = await getDoc(doc(db, 'invites', code))
  if (!snap.exists()) return null
  return parseInviteDoc(snap.data() as Record<string, unknown>)
}

export async function redeemInvite(
  code: string,
  uid: string,
  usedByEmail?: string,
  usedByName?: string,
): Promise<{ companyId: string; role: string }> {
  const snap = await getDoc(doc(db, 'invites', code))
  if (!snap.exists()) throw new Error('Invite not found.')
  const invite = parseInviteDoc(snap.data() as Record<string, unknown>)
  if (invite.revoked) throw new Error('This invite link was cancelled.')
  if (invite.used) throw new Error('This invite link has already been used.')
  if (invite.expiresAt.toDate() < new Date()) throw new Error('This invite link has expired.')

  await setDoc(doc(db, 'users', uid), { companyId: invite.companyId, role: invite.role }, { merge: true })
  await updateDoc(doc(db, 'invites', code), {
    used: true,
    usedBy: uid,
    usedByEmail: usedByEmail ?? null,
    usedByName: usedByName ?? null,
    usedAt: serverTimestamp(),
  })

  // Sync the new companyId into the user's Firebase Auth custom claims so that
  // Firestore security rules (which check the token claim) work immediately.
  // syncUserClaims also writes a claimRefreshSignals doc for the auth store's
  // background listener, but that round-trip is too slow for what happens
  // next: the caller navigates straight to the dashboard, whose queries would
  // otherwise fire with the pre-join token and get denied. Force the refresh
  // here so it's already applied before this call resolves.
  try {
    const fns = getFunctions()
    await httpsCallable(fns, 'syncUserClaims')({})
    await auth.currentUser?.getIdToken(true)
  } catch {
    // If CF is unavailable the user may need to sign out and back in.
  }

  return { companyId: invite.companyId, role: invite.role }
}

export function subscribeToInvites(
  onData: (invites: InviteRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }
  const q = query(
    collection(db, 'invites'),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
  )
  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => ({ code: d.id, ...parseInviteDoc(d.data() as Record<string, unknown>) }))),
    err => onError?.(err),
  )
}

// ── Email invitations ─────────────────────────────────────────────────────────
//
// The other invite path. `/settings` calls the `inviteUser` callable, which
// writes to `invitations` and emails a /register link; `/team` writes links to
// `invites`. Two collections, and the Team page's "Invite History" only ever
// read one of them — so anyone invited by email was absent from the page that
// claims to list invites.

export interface EmailInviteRecord {
  id: string
  email: string
  companyId: string
  invitedBy: string
  /** 'pending' | 'accepted' | 'revoked' — written by the callable. */
  status: string
  createdAt: Timestamp | null
}

function parseEmailInvite(id: string, d: Record<string, unknown>): EmailInviteRecord {
  return {
    id,
    email:     typeof d.email     === 'string' ? d.email     : '',
    companyId: typeof d.companyId === 'string' ? d.companyId : '',
    invitedBy: typeof d.invitedBy === 'string' ? d.invitedBy : '',
    status:    typeof d.status    === 'string' ? d.status    : 'pending',
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt : null,
  }
}

export function subscribeToEmailInvites(
  onData: (invites: EmailInviteRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }
  // No orderBy: these docs predate any index, and createdAt is missing on the
  // oldest of them, which orderBy would silently drop. Sorted client-side.
  return onSnapshot(
    query(collection(db, 'invitations'), where('companyId', '==', companyId)),
    snap => onData(snap.docs.map(d => parseEmailInvite(d.id, d.data() as Record<string, unknown>))),
    err => onError?.(err),
  )
}

export async function revokeEmailInvite(id: string): Promise<void> {
  await updateDoc(doc(db, 'invitations', id), {
    status: 'revoked',
    revokedAt: serverTimestamp(),
  })
}

// The unified history model is pure logic with no Firebase or store
// dependencies, so it lives in models/invite.ts where it can be tested.
export {
  unifyInvites,
  type InviteState, type UnifiedInvite, type InviteLike, type EmailInviteLike,
} from '../models/invite'
