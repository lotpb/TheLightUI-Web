import type { LeadSubmission, SubmissionStatus } from './leadForm'

/**
 * Filtering, counting and dirty-checking for /lead-forms.
 *
 * The submissions tab offered scrolling and nothing else over a listener
 * capped at 5,000 anonymous public writes, and the Setup tab had no idea
 * whether anything was unsaved.
 */

export type SubmissionFilter = 'all' | 'new' | 'contacted' | 'converted' | 'spam'

export const SUBMISSION_FILTERS: { key: SubmissionFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'new',       label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'converted', label: 'Converted' },
  { key: 'spam',      label: 'Flagged' },
]

export function isSubmissionFilter(v: string | null): v is SubmissionFilter {
  return v === 'all' || v === 'new' || v === 'contacted' || v === 'converted' || v === 'spam'
}

export function matchesSubmissionFilter(s: LeadSubmission, filter: SubmissionFilter): boolean {
  return filter === 'all' ? true : s.status === filter
}

export function searchSubmissions(subs: LeadSubmission[], search: string): LeadSubmission[] {
  const q = search.trim().toLowerCase()
  if (!q) return subs
  const digits = q.replace(/\D/g, '')
  return subs.filter(s =>
    `${s.first} ${s.lastname}`.toLowerCase().includes(q) ||
    s.email.toLowerCase().includes(q) ||
    s.message.toLowerCase().includes(q) ||
    s.city.toLowerCase().includes(q) ||
    // So "555 123" finds a phone stored as (555) 123-4567.
    (digits.length >= 3 && s.phone.replace(/\D/g, '').includes(digits)),
  )
}

export type SubmissionSort = 'newest' | 'oldest' | 'name'

export const SUBMISSION_SORTS: { key: SubmissionSort; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name',   label: 'Name A–Z' },
]

export function sortSubmissions(subs: LeadSubmission[], sort: SubmissionSort): LeadSubmission[] {
  const byNewest = (a: LeadSubmission, b: LeadSubmission) =>
    b.submittedAt.getTime() - a.submittedAt.getTime()
  const cmp: Record<SubmissionSort, (a: LeadSubmission, b: LeadSubmission) => number> = {
    newest: byNewest,
    oldest: (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
    name:   (a, b) => `${a.first} ${a.lastname}`.localeCompare(`${b.first} ${b.lastname}`),
  }
  const primary = cmp[sort]
  return [...subs].sort((a, b) => primary(a, b) || byNewest(a, b))
}

export function filterSubmissions(
  subs: LeadSubmission[],
  filter: SubmissionFilter,
  search: string,
  sort: SubmissionSort,
): LeadSubmission[] {
  return sortSubmissions(searchSubmissions(subs.filter(s => matchesSubmissionFilter(s, filter)), search), sort)
}

export type SubmissionCounts = Record<SubmissionFilter, number>

export function submissionCounts(subs: LeadSubmission[]): SubmissionCounts {
  const counts: SubmissionCounts = { all: subs.length, new: 0, contacted: 0, converted: 0, spam: 0 }
  for (const s of subs) {
    const key = s.status as SubmissionStatus
    if (key === 'new' || key === 'contacted' || key === 'converted' || key === 'spam') counts[key]++
  }
  return counts
}

/** Names the active filter, for the empty state. */
export function describeSubmissionFilter(filter: SubmissionFilter, search: string): string {
  const label = SUBMISSION_FILTERS.find(f => f.key === filter)?.label ?? 'All'
  const q = search.trim()
  return q ? `${label} · matching “${q}”` : label
}

// ── Duplicate detection ───────────────────────────────────────────────────────

/**
 * An existing customer this submission is probably already about.
 *
 * handleConvert called createCustomer unconditionally, so the same person
 * submitting the form twice produced two leads — in an app that has a whole
 * /duplicates page for cleaning that up afterwards. Matched on email first,
 * then on the last ten digits of the phone, which is how the SMS webhook
 * matches a sender.
 */
export function findExistingMatch<T extends { id: string; email: string; phone: string }>(
  sub: Pick<LeadSubmission, 'email' | 'phone'>,
  customers: T[],
): T | null {
  const email = sub.email.trim().toLowerCase()
  if (email) {
    const byEmail = customers.find(c => c.email.trim().toLowerCase() === email)
    if (byEmail) return byEmail
  }
  const digits = sub.phone.replace(/\D/g, '').slice(-10)
  if (digits.length === 10) {
    const byPhone = customers.find(c => c.phone.replace(/\D/g, '').slice(-10) === digits)
    if (byPhone) return byPhone
  }
  return null
}

// ── Settings dirty-checking ───────────────────────────────────────────────────

export interface FormSettingsDraft {
  businessName: string
  title: string
  subtitle: string
  thankYouMessage: string
  showPhone: boolean
  showAddress: boolean
  showMessage: boolean
  enabled: boolean
}

/**
 * Whether the Setup tab has unsaved edits.
 *
 * The Save button was always enabled whether or not anything had changed, and
 * navigating away lost the edits with no prompt — the button read "Save
 * Settings" identically in both states.
 */
export function settingsDirty(draft: FormSettingsDraft, saved: FormSettingsDraft | null): boolean {
  if (saved === null) return false
  return (Object.keys(draft) as (keyof FormSettingsDraft)[]).some(k => draft[k] !== saved[k])
}
