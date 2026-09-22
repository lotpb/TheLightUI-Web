import { daysUntilDue } from '../utils/dueDate'
import { displayName, fullName, type CustomerItem } from './customer'

/**
 * Bucketing for /followups' queue.
 *
 * subscribeToFollowUps used to window followUpDate at yesterday's midnight, so
 * anything overdue by two days or more never reached this page at all. That was
 * widened to a year — correct, because a follow-up nobody actioned is the most
 * important row in the product — but this page renders one card per result with
 * no cap and no grouping, and its default filter was "All". So the fix turned a
 * two-week work queue into an unbounded list of up to a year of history, with
 * the oldest items at the top and today's work buried below them.
 *
 * Hence a fourth bucket. "Overdue" keeps its meaning — late, still worth
 * chasing — and anything older than STALE_DAYS becomes its own group that the
 * default view excludes and a chip reveals with a count. The default view is
 * therefore what it was before the window changed, plus the recently-overdue
 * items that were previously invisible.
 */

/**
 * Past this many days late, a follow-up is more likely abandoned than urgent.
 *
 * 30 is a month of missed contact — long enough that the record needs a
 * decision (re-engage or clear) rather than a callback, which is why the stale
 * group is presented apart from the working queue rather than ranked inside it.
 */
export const STALE_DAYS = 30

/** How many rows render before the list asks. */
export const RENDER_CAP = 50

export type FollowUpBucket = 'overdue' | 'today' | 'upcoming' | 'stale'

export type QueueFilter = 'active' | FollowUpBucket

export interface BucketedFollowUps {
  /** Late, but inside STALE_DAYS. */
  overdue: CustomerItem[]
  today: CustomerItem[]
  upcoming: CustomerItem[]
  /** Late by more than STALE_DAYS — excluded from the default view. */
  stale: CustomerItem[]
}

/**
 * Splits the queue by urgency.
 *
 * Order is inherited: subscribeToFollowUps already sorts ascending by
 * followUpDate, so overdue comes out most-overdue-first (work the longest
 * neglected first) and upcoming comes out soonest-first. Nothing re-sorts here,
 * which is what keeps the page's order and the service's agreeing.
 *
 * `daysUntilDue` comes from utils/dueDate, so this page's idea of "late" is the
 * same one /todo, /dashboard and the record page use. It had its own —
 * `Math.round((date - localMidnight) / 86_400_000)` — making it the third
 * implementation of the same verdict in the app.
 */
export function bucketFollowUps(customers: CustomerItem[]): BucketedFollowUps {
  const out: BucketedFollowUps = { overdue: [], today: [], upcoming: [], stale: [] }
  for (const c of customers) {
    if (!c.followUpDate) continue
    const days = daysUntilDue(c.followUpDate)
    if (days < -STALE_DAYS) out.stale.push(c)
    else if (days < 0)      out.overdue.push(c)
    else if (days === 0)    out.today.push(c)
    else                    out.upcoming.push(c)
  }
  return out
}

/** The working queue: everything except the stale backlog. */
export function activeFollowUps(b: BucketedFollowUps): CustomerItem[] {
  return [...b.overdue, ...b.today, ...b.upcoming]
}

export function filteredFollowUps(b: BucketedFollowUps, filter: QueueFilter): CustomerItem[] {
  switch (filter) {
    case 'overdue':  return b.overdue
    case 'today':    return b.today
    case 'upcoming': return b.upcoming
    case 'stale':    return b.stale
    default:         return activeFollowUps(b)
  }
}

export interface QueueChip {
  key: QueueFilter
  label: string
  count: number
  /** True for the chip that should draw attention when non-empty. */
  alert: boolean
}

/**
 * The filter chips, in working order.
 *
 * "Active" leads, and is the default — the old default was "All", which after
 * the window widened meant opening the page on a follow-up from up to a year
 * ago. Stale sits last and is the only chip that can be empty and still worth
 * showing, because its count is the thing a manager needs to see.
 */
export function queueChips(b: BucketedFollowUps): QueueChip[] {
  return [
    { key: 'active',   label: 'Active',   count: activeFollowUps(b).length, alert: false },
    { key: 'overdue',  label: 'Overdue',  count: b.overdue.length,          alert: true },
    { key: 'today',    label: 'Today',    count: b.today.length,            alert: false },
    { key: 'upcoming', label: 'Upcoming', count: b.upcoming.length,         alert: false },
    { key: `stale`,    label: `Stale`,    count: b.stale.length,            alert: false },
  ]
}

/** What the empty state should say, which depends on which filter is on. */
export function emptyMessage(filter: QueueFilter, b: BucketedFollowUps): string {
  if (filter === 'stale') return `No follow-up is more than ${STALE_DAYS} days late.`
  if (filter === 'active') {
    return b.stale.length > 0
      ? `Nothing due. ${b.stale.length} follow-up${b.stale.length === 1 ? '' : 's'} ${b.stale.length === 1 ? 'is' : 'are'} more than ${STALE_DAYS} days late — see Stale.`
      : 'No follow-ups due.'
  }
  return 'Nothing in this category.'
}

/**
 * The name to show on a row.
 *
 * The page rendered `{c.first} {c.lastname}`, so a company record — which the
 * rest of the app titles by `companyName` — appeared blank or as a stray
 * contact name. displayName is the shared convention; fullName is the person
 * underneath it, shown as a subtitle when the two differ.
 */
export function rowName(c: CustomerItem): { title: string; sub: string } {
  const title = displayName(c)
  const person = fullName(c).trim()
  return {
    title: title || 'Unnamed record',
    sub: c.companyName.trim() && person ? person : '',
  }
}

/** Initials for the row avatar, from whatever the row is titled. */
export function rowInitials(c: CustomerItem): string {
  const { title } = rowName(c)
  const words = title.split(/\s+/).filter(Boolean)
  const letters = c.companyName.trim()
    ? words.slice(0, 2).map(w => w[0])
    : [c.first[0], c.lastname[0]].filter(Boolean)
  return (letters.join('') || '?').toUpperCase()
}
