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
  }
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
