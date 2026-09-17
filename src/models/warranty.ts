import { dayIndexUTC, fmtDue, todayIndexLocal } from '../utils/dueDate'

export interface Warranty {
  id: string
  companyId: string
  customerId: string
  customerName: string
  title: string
  provider: string
  startDate: Date
  expirationDate: Date
  notes: string
  isActive: boolean
  lastReminderSentAt: Date | null
  createdAt: Date
}

/**
 * How many days before expiry the customer is emailed.
 *
 * warrantyExpirationReminders in functions/src/alerts.ts queries
 * `expirationDate <= now + 30 days`, so "Expiring Soon" on this page and the
 * window that actually triggers an email have to be the same number.
 * warranty.test.ts reads the function's source and checks that they are.
 */
export const EXPIRY_WINDOW_DAYS = 30

/**
 * Whole days until a warranty expires. Negative means it already has.
 *
 * Warranty dates are day-granular and every write path lands them on UTC
 * midnight (`new Date('2026-09-17')` out of a date input), so they have to be
 * compared and rendered in UTC — see the header of utils/dueDate.ts. This
 * used to be `(expirationDate.getTime() - Date.now()) / 86400000`, which
 * mixes a UTC-midnight instant with the current local instant and so answered
 * a fractional number of days rather than a calendar difference.
 */
export function daysUntilExpiration(w: Pick<Warranty, 'expirationDate'>): number {
  return dayIndexUTC(w.expirationDate) - todayIndexLocal()
}

export function isExpired(w: Pick<Warranty, 'expirationDate'>): boolean {
  return daysUntilExpiration(w) < 0
}

export function isExpiringSoon(w: Pick<Warranty, 'expirationDate'>): boolean {
  const days = daysUntilExpiration(w)
  return days >= 0 && days <= EXPIRY_WINDOW_DAYS
}

/**
 * Renders a warranty date in the timezone it was stored in.
 *
 * A bare toLocaleDateString() prints the day before for anyone west of UTC,
 * so a warranty entered as expiring 2026-09-17 displayed as "Sep 16, 2026" —
 * and because the edit form read it back with local getters, every
 * edit-and-save moved it one more day earlier.
 */
export const fmtWarrantyDate = fmtDue

/** The `yyyy-mm-dd` an <input type="date"> needs, read back in UTC. */
export function warrantyDateToInput(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// ── Status ────────────────────────────────────────────────────────────────────

export type WarrantyStatus = 'active' | 'expiringSoon' | 'expired' | 'inactive'

/**
 * One definition of a warranty's status, shared with the Related Records
 * panel on /records/:id — which had its own copy of this function with the
 * same four branches and the same class strings.
 */
export function warrantyStatusOf(w: Pick<Warranty, 'expirationDate' | 'isActive'>): WarrantyStatus {
  if (!w.isActive) return 'inactive'
  if (isExpired(w)) return 'expired'
  if (isExpiringSoon(w)) return 'expiringSoon'
  return 'active'
}

export const WARRANTY_STATUS_LABELS: Record<WarrantyStatus, string> = {
  active:       'Active',
  expiringSoon: 'Expiring Soon',
  expired:      'Expired',
  inactive:     'Inactive',
}

/**
 * Badge classes per status.
 *
 * index.css carries explicit light-mode rules for the yellow and red
 * combinations below; the green one was missed, leaving Active at 4.22:1 on
 * the white card while its two siblings sat at 21:1. The rule is there now,
 * keyed on this exact class triple — so these strings and that stylesheet
 * have to stay in step, which warranty.test.ts asserts.
 */
export const WARRANTY_STATUS_COLORS: Record<WarrantyStatus, string> = {
  active:       'bg-green-500/20 text-green-400 border-green-600/40',
  expiringSoon: 'bg-yellow-500/20 text-yellow-400 border-yellow-600/40',
  expired:      'bg-red-500/20 text-red-400 border-red-600/40',
  inactive:     'bg-gray-700/60 text-gray-300 border-gray-600/40',
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * 'open' exists because the page defaulted to 'active', which is defined as
 * active AND NOT expiring soon — so the landing view of an expiration tracker
 * excluded precisely the warranties that needed action. The counts were right
 * on the cards above and the list below didn't contain them.
 */
export type WarrantyFilter = 'open' | WarrantyStatus | 'all'

export const WARRANTY_FILTERS: { key: WarrantyFilter; label: string }[] = [
  { key: 'open',         label: 'Open' },
  { key: 'active',       label: 'Active' },
  { key: 'expiringSoon', label: 'Expiring Soon' },
  { key: 'expired',      label: 'Expired' },
  { key: 'inactive',     label: 'Inactive' },
  { key: 'all',          label: 'All' },
]

export function matchesWarrantyFilter(w: Warranty, filter: WarrantyFilter): boolean {
  if (filter === 'all')  return true
  // Everything still in force, expiring ones included, soonest first.
  if (filter === 'open') return w.isActive && !isExpired(w)
  return warrantyStatusOf(w) === filter
}

export function filterWarranties(items: Warranty[], filter: WarrantyFilter): Warranty[] {
  return items.filter(w => matchesWarrantyFilter(w, filter))
}

export interface WarrantyCounts {
  open: number
  active: number
  expiringSoon: number
  expired: number
  inactive: number
  all: number
}

export function warrantyCounts(items: Warranty[]): WarrantyCounts {
  const counts: WarrantyCounts = { open: 0, active: 0, expiringSoon: 0, expired: 0, inactive: 0, all: items.length }
  for (const w of items) {
    counts[warrantyStatusOf(w)]++
    if (w.isActive && !isExpired(w)) counts.open++
  }
  return counts
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface WarrantyFormDates {
  startDate: string
  expirationDate: string
}

/**
 * Why the form can't be submitted, or null when it can.
 *
 * Coverage ending before it starts saved happily and then rendered as Expired
 * with a start date in the future — nothing checked the two dates against
 * each other.
 */
export function warrantyFormError(form: WarrantyFormDates & {
  customerId: string
  title: string
}): string | null {
  if (!form.customerId) return 'Pick a customer from the list so the warranty is linked to their record.'
  if (!form.title.trim()) return 'Give the warranty a title.'
  if (!form.startDate) return 'Choose a start date.'
  if (!form.expirationDate) return 'Choose an expiration date.'
  const start = Date.parse(`${form.startDate}T00:00:00Z`)
  const end   = Date.parse(`${form.expirationDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 'One of these dates isn’t a real date.'
  if (end < start)   return 'Coverage can’t end before it starts — check the expiration date.'
  if (end === start) return 'Start and expiration are the same day. Set an expiration after the start date.'
  return null
}

/** A note for a plausible-but-odd term, shown without blocking submit. */
export function warrantyTermWarning(form: WarrantyFormDates): string | null {
  if (!form.startDate || !form.expirationDate) return null
  const start = Date.parse(`${form.startDate}T00:00:00Z`)
  const end   = Date.parse(`${form.expirationDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
  const days = (end - start) / 86_400_000
  const years = days / 365.2425
  if (years > 60) return `That’s a ${Math.round(years)}-year term — check the expiration year.`
  if (days < 7)   return 'That term is under a week. Check the dates.'
  return null
}
