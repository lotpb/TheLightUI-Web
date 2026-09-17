import { fullName, type CustomerItem } from './customer'

export interface Referral {
  id: string
  companyId: string
  referrerId: string
  referrerName: string
  referredId: string
  referredName: string
  /**
   * The deal value recorded when the referral was logged.
   *
   * A snapshot, not a live figure: the form auto-fills it from the referred
   * customer's `amount` and nothing updates it afterwards. That's defensible —
   * a referral is a historical event — but the page presented it as the deal
   * value, so it silently disagreed with /customers once a deal changed.
   * referralAmountDrift() below is what lets the UI show both.
   */
  referredAmount: number
  notes: string
  createdAt: Date
}

// ── Name resolution ───────────────────────────────────────────────────────────

/**
 * The customer's current name, falling back to what was stored.
 *
 * referrerName/referredName are snapshots taken at log time, so renaming a
 * customer left every existing referral showing the old name — and the
 * leaderboard, which groups by id, displayed whichever name happened to be on
 * the first document it iterated. Resolving against the live customer list
 * fixes both; the snapshot remains the fallback for a deleted record.
 */
export function resolveReferralName(
  id: string, storedName: string, byId: Map<string, CustomerItem>,
): string {
  const c = byId.get(id)
  if (c) {
    const live = fullName(c).trim()
    if (live) return live
  }
  return storedName.trim() || 'Unknown'
}

export function customersById(customers: CustomerItem[]): Map<string, CustomerItem> {
  return new Map(customers.map(c => [c.id, c]))
}

/** True when the referred customer no longer exists in the customer list. */
export function referredIsMissing(r: Referral, byId: Map<string, CustomerItem>): boolean {
  return !!r.referredId && !byId.has(r.referredId)
}

/**
 * How the recorded amount compares to the customer's current deal value.
 *
 * Null when there's nothing to say — no customer on file, or the two agree.
 */
export function referralAmountDrift(
  r: Referral, byId: Map<string, CustomerItem>,
): { recorded: number; current: number } | null {
  const c = byId.get(r.referredId)
  if (!c) return null
  const current = c.amount ?? 0
  if (current === r.referredAmount) return null
  return { recorded: r.referredAmount, current }
}

// ── Duplicates ────────────────────────────────────────────────────────────────

/**
 * An existing referral for the same pair, most recent first.
 *
 * addReferral was a bare addDoc with no check, so the same referrer→referred
 * pair could be logged any number of times — each one adding to the count and
 * adding the full auto-filled deal value again to that referrer's revenue. On
 * a leaderboard people compare themselves against, that was invisible.
 */
export function findDuplicateReferrals(
  referrals: Referral[], referrerId: string, referredId: string,
): Referral[] {
  if (!referrerId || !referredId) return []
  return referrals
    .filter(r => r.referrerId === referrerId && r.referredId === referredId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/** Why a referral can't be logged, or null when it can. */
export function referralFormError(
  referrerId: string, referredId: string, amount: string,
): string | null {
  if (!referrerId) return 'Pick the customer who sent the referral.'
  if (!referredId) return 'Pick the customer they referred.'
  if (referrerId === referredId) return 'A customer can’t refer themselves.'
  if (amount.trim()) {
    const n = Number(amount)
    if (!Number.isFinite(n) || n < 0) return 'The deal amount isn’t a valid number.'
  }
  return null
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export interface ReferrerStat {
  id: string
  name: string
  count: number
  revenue: number
  /** Most recent referral first. */
  entries: Referral[]
  lastAt: Date
}

export type ReferralSort = 'revenue' | 'count' | 'recent'

export const REFERRAL_SORTS: { key: ReferralSort; label: string }[] = [
  { key: 'revenue', label: 'By revenue' },
  { key: 'count',   label: 'By count' },
  { key: 'recent',  label: 'Most recent' },
]

export function buildLeaderboard(
  referrals: Referral[],
  sort: ReferralSort,
  byId: Map<string, CustomerItem> = new Map(),
): ReferrerStat[] {
  const map = new Map<string, ReferrerStat>()

  for (const r of referrals) {
    const existing = map.get(r.referrerId)
    if (existing) {
      existing.count++
      existing.revenue += r.referredAmount
      existing.entries.push(r)
      if (r.createdAt.getTime() > existing.lastAt.getTime()) existing.lastAt = r.createdAt
    } else {
      map.set(r.referrerId, {
        id: r.referrerId,
        // Resolved rather than taken from the first document seen.
        name: resolveReferralName(r.referrerId, r.referrerName, byId),
        count: 1,
        revenue: r.referredAmount,
        entries: [r],
        lastAt: r.createdAt,
      })
    }
  }

  const rows = [...map.values()]
  for (const row of rows) {
    row.entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  return rows.sort((a, b) => {
    switch (sort) {
      case 'revenue': return b.revenue - a.revenue || b.count - a.count || a.name.localeCompare(b.name)
      case 'count':   return b.count - a.count || b.revenue - a.revenue || a.name.localeCompare(b.name)
      case 'recent':  return b.lastAt.getTime() - a.lastAt.getTime() || a.name.localeCompare(b.name)
    }
  })
}

export interface ReferralTotals {
  referrals: number
  referrers: number
  revenue: number
  /** How many carry no deal value, so the revenue figure can be honest. */
  withoutAmount: number
}

export function referralTotals(referrals: Referral[]): ReferralTotals {
  const referrers = new Set<string>()
  let revenue = 0
  let withoutAmount = 0
  for (const r of referrals) {
    referrers.add(r.referrerId)
    revenue += r.referredAmount
    if (r.referredAmount <= 0) withoutAmount++
  }
  return { referrals: referrals.length, referrers: referrers.size, revenue, withoutAmount }
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Matches a customer for the picker.
 *
 * It searched `fullName` alone, so two people with the same name were
 * indistinguishable — on a form whose whole job is picking the right two.
 */
export function matchesReferralQuery(c: CustomerItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const digits = q.replace(/\D/g, '')
  return (
    fullName(c).toLowerCase().includes(q) ||
    c.email.toLowerCase().includes(q) ||
    c.city.toLowerCase().includes(q) ||
    // So "555 123" finds a phone stored as (555) 123-4567.
    (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))
  )
}

export function searchReferralCandidates(
  customers: CustomerItem[], query: string, excludeId: string | undefined, limit: number,
): { matches: CustomerItem[]; total: number } {
  const all = customers.filter(c => c.id !== excludeId && matchesReferralQuery(c, query))
  return { matches: all.slice(0, limit), total: all.length }
}
