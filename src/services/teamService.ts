import {
  collection, doc, getDocs, onSnapshot, query, where, setDoc,
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

function roleRank(r: string | null): number {
  switch (r) { case 'owner': return 0; case 'admin': return 1; case 'salesman': return 2; case 'viewer': return 3; default: return 4 }
}

export function compareMembers(
  a: { role: string | null; firstName: string; email: string },
  b: { role: string | null; firstName: string; email: string },
): number {
  const ro = roleRank(a.role) - roleRank(b.role)
  if (ro !== 0) return ro
  return (a.firstName || a.email).localeCompare(b.firstName || b.email)
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
      members.sort(compareMembers)
      onData(members)
    },
    onError,
  )
}

export function memberDisplayName(m: { firstName: string; lastName: string; email: string }): string {
  const full = `${m.firstName} ${m.lastName}`.trim()
  return full || m.email.split('@')[0]
}

// One-off fetch (not a live subscription) of the company's salesman-role users,
// for lead-assignment pickers. Used instead of subscribeToTeam because assign
// UIs are short-lived popovers, not screens that need to track role changes live.
export async function fetchSalesmenForCompany(): Promise<TeamMember[]> {
  const companyId = getCompanyId()
  if (!companyId) return []
  const snap = await getDocs(
    query(collection(db, COL), where('companyId', '==', companyId), where('role', '==', 'salesman')),
  )
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
  members.sort(compareMembers)
  return members
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

// ── Cross-company team listing (super-admin only) ───────────────────────────────
// This allowlist is a UI hint only — the real gate is enforced server-side in the
// adminListAllTeams Cloud Function against the caller's verified ID-token email.
export const SUPER_ADMIN_EMAILS = ['eunitedws@gmail.com', 'eunitedws@icloud.com'] as const

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return !!email && (SUPER_ADMIN_EMAILS as readonly string[]).includes(email.toLowerCase())
}

export interface AllTeamsMember {
  uid: string
  email: string
  firstName: string
  lastName: string
  displayName: string
  profileImageUrl: string
  role: string | null
  isOwner: boolean
  isOnline: boolean
  createdAt: Date | null
  lastSeen: Date | null
}

export interface CompanyTeamGroup {
  kind: 'company' | 'orphan' | 'unassigned'
  companyId: string
  name: string
  plan: string
  ownerUid: string
  ownerEmail: string
  ownerMissing: boolean
  createdAt: Date | null
  memberCount: number
  members: AllTeamsMember[]
}

export interface AllTeamsResult {
  generatedAt: Date | null
  truncated: boolean
  totalCompanies: number
  totalMembers: number
  groups: CompanyTeamGroup[]
}

function coerceMember(r: Record<string, unknown>): AllTeamsMember {
  return {
    uid:             s(r, 'uid'),
    email:           s(r, 'email'),
    firstName:       s(r, 'firstName'),
    lastName:        s(r, 'lastName'),
    displayName:     s(r, 'displayName'),
    profileImageUrl: s(r, 'profileImageUrl'),
    role:            typeof r['role'] === 'string' ? r['role'] as string : null,
    isOwner:         typeof r['isOwner'] === 'boolean' ? r['isOwner'] : false,
    isOnline:        typeof r['isOnline'] === 'boolean' ? r['isOnline'] : false,
    createdAt:       toDate(r['createdAt']),
    lastSeen:        toDate(r['lastSeen']),
  }
}

function coerceGroup(r: Record<string, unknown>): CompanyTeamGroup {
  const kind = r['kind']
  const members = Array.isArray(r['members']) ? (r['members'] as Record<string, unknown>[]).map(coerceMember) : []
  members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || compareMembers(a, b))
  return {
    kind: kind === 'orphan' || kind === 'unassigned' ? kind : 'company',
    companyId:    s(r, 'companyId'),
    name:         s(r, 'name'),
    plan:         s(r, 'plan'),
    ownerUid:     s(r, 'ownerUid'),
    ownerEmail:   s(r, 'ownerEmail'),
    ownerMissing: typeof r['ownerMissing'] === 'boolean' ? r['ownerMissing'] : false,
    createdAt:    toDate(r['createdAt']),
    memberCount:  typeof r['memberCount'] === 'number' ? r['memberCount'] : members.length,
    members,
  }
}

export async function fetchAllCompaniesTeam(): Promise<AllTeamsResult> {
  const fns = getFunctions()
  const fn = httpsCallable<Record<string, never>, Record<string, unknown>>(fns, 'adminListAllTeams')
  const result = await fn({})
  const r = result.data
  const totals = (r['totals'] ?? {}) as Record<string, unknown>
  const groups = Array.isArray(r['groups']) ? (r['groups'] as Record<string, unknown>[]).map(coerceGroup) : []
  return {
    generatedAt:    toDate(r['generatedAt']),
    truncated:      typeof r['truncated'] === 'boolean' ? r['truncated'] : false,
    totalCompanies: typeof totals['companies'] === 'number' ? totals['companies'] as number : groups.length,
    totalMembers:   typeof totals['members'] === 'number' ? totals['members'] as number : 0,
    groups,
  }
}

export async function deleteOrphanCompany(companyId: string): Promise<void> {
  const fns = getFunctions()
  const fn = httpsCallable<{ companyId: string }, { success: boolean }>(fns, 'adminDeleteOrphanCompany')
  await fn({ companyId })
}

export function callableErrorMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code
  switch (code) {
    case 'functions/permission-denied': return 'You are not authorized to view all companies.'
    case 'functions/unauthenticated':   return 'Please sign in again.'
    case 'functions/resource-exhausted': return 'Too many requests — try again in a minute.'
    default: return 'Could not load companies. Check that adminListAllTeams is deployed.'
  }
}

/**
 * The team member whose account email matches `email`, or null.
 *
 * Used by the customer detail page to show an Employee record's live user role
 * and last login. Queries by email rather than downloading every team member
 * and matching client-side — two equality filters, so no composite index.
 * Email is stored as entered, so the comparison is done on a normalised copy
 * of the stored value as a fallback when the exact match misses.
 */
export async function findMemberByEmail(email: string): Promise<TeamMember | null> {
  const companyId = getCompanyId()
  const target = email.trim().toLowerCase()
  if (!companyId || !target) return null

  const exact = await getDocs(query(
    collection(db, COL),
    where('companyId', '==', companyId),
    where('email', '==', target),
  ))
  if (!exact.empty) return toMember(exact.docs[0].id, exact.docs[0].data() as Record<string, unknown>)

  // Stored with different casing — fall back to a company-scoped scan.
  const all = await getDocs(query(collection(db, COL), where('companyId', '==', companyId)))
  const match = all.docs.find(d => s(d.data() as Record<string, unknown>, 'email').trim().toLowerCase() === target)
  return match ? toMember(match.id, match.data() as Record<string, unknown>) : null
}

function toMember(uid: string, d: Record<string, unknown>): TeamMember {
  return {
    uid,
    email:           s(d, 'email'),
    firstName:       s(d, 'firstName'),
    lastName:        s(d, 'lastName'),
    profileImageUrl: s(d, 'profileImageUrl'),
    companyId:       s(d, 'companyId'),
    role:            s(d, 'role') || null,
    createdAt:       toDate(d['createdAt']),
    isOnline:        d['isOnline'] === true,
    lastSeen:        toDate(d['lastSeen']),
  }
}
