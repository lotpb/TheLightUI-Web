import {
  collection, doc, onSnapshot, query, where, setDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

const COL = 'users'

export interface TeamMember {
  uid: string
  email: string
  firstName: string
  lastName: string
  profileImageUrl: string
  companyId: string
  role: string | null
  createdAt: Date | null
  isOnline: boolean
  lastSeen: Date | null
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  if (v && typeof v === 'object' && 'toDate' in v) return (v as { toDate(): Date }).toDate()
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d }
  return null
}

function s(d: Record<string, unknown>, k: string): string {
  return typeof d[k] === 'string' ? (d[k] as string) : ''
}

export function subscribeToTeam(
  onData: (members: TeamMember[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onError(new Error('Not authenticated')); return () => {} }
  return onSnapshot(
    query(collection(db, COL), where('companyId', '==', companyId)),
    snap => {
      const members: TeamMember[] = snap.docs.map(d => {
        const r = d.data() as Record<string, unknown>
        return {
          uid:             d.id,
          email:           s(r, 'email'),
          firstName:       s(r, 'firstName'),
          lastName:        s(r, 'lastName'),
          profileImageUrl: s(r, 'profileImageUrl'),
          companyId:       s(r, 'companyId'),
          role:            typeof r['role'] === 'string' ? r['role'] : null,
          createdAt:       toDate(r['createdAt']),
          isOnline:        typeof r['isOnline'] === 'boolean' ? r['isOnline'] : false,
          lastSeen:        toDate(r['lastSeen']),
        }
      })
      members.sort((a, b) => {
        // owner → admin → salesman → viewer → rest
        const roleOrder = (r: string | null) => {
          switch (r) { case 'owner': return 0; case 'admin': return 1; case 'salesman': return 2; case 'viewer': return 3; default: return 4 }
        }
        const ro = roleOrder(a.role) - roleOrder(b.role)
        if (ro !== 0) return ro
        return (a.firstName || a.email).localeCompare(b.firstName || b.email)
      })
      onData(members)
    },
    onError,
  )
}

export function memberDisplayName(m: TeamMember): string {
  const full = `${m.firstName} ${m.lastName}`.trim()
  return full || m.email.split('@')[0]
}

// Calls the inviteUser Cloud Function (already exists in backend)
export async function inviteTeamMember(email: string): Promise<{ alreadyInvited: boolean }> {
  const fns = getFunctions()
  const fn = httpsCallable<{ email: string }, { success: boolean; alreadyInvited: boolean }>(fns, 'inviteUser')
  const result = await fn({ email })
  return { alreadyInvited: result.data.alreadyInvited }
}

// Update role in the user's Firestore doc + call setUserRole CF if available
export async function setMemberRole(uid: string, role: string): Promise<void> {
  // Write to user doc (readable by the app; picked up by fixRole on next login)
  await setDoc(doc(db, COL, uid), { role }, { merge: true })
  // Also call Cloud Function if it exists — gracefully ignore if not deployed
  try {
    const fns = getFunctions()
    const fn = httpsCallable<{ uid: string; role: string }, unknown>(fns, 'setUserRole')
    await fn({ uid, role })
  } catch {
    // CF not deployed — Firestore-only update is sufficient for display
  }
}

// Call removeTeamMember CF if available; on failure, clear their companyId in Firestore
export async function removeTeamMember(uid: string): Promise<void> {
  try {
    const fns = getFunctions()
    const fn = httpsCallable<{ uid: string }, unknown>(fns, 'removeTeamMember')
    await fn({ uid })
  } catch {
    // CF not deployed — remove companyId from user doc so they no longer appear in team
    await setDoc(doc(db, COL, uid), { companyId: '' }, { merge: true })
  }
}
