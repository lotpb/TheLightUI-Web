import { fullName, type CustomerItem } from './customer'
import { ACTIVITY_TYPES, type Activity, type ActivityType } from './activity'
import { groupByDay, type DayGroup } from '../utils/dayGroups'

/**
 * Presentation logic for /activity.
 *
 * The page resolved customer names against a map that silently misses, ranked
 * its own day buckets, and counted its filter chips off a different list than
 * the one on screen.
 */

export type ActivityFilter = ActivityType | 'all'

export interface FeedRow extends Activity {
  /** The customer's current name, or null when the record can't be found. */
  customerName: string | null
  /** True when the customer is missing from the loaded set. */
  customerMissing: boolean
  /** Label for the activity type, or null for a type we don't recognise. */
  typeLabel: string | null
}

/**
 * Attaches the customer name and the type label to each activity.
 *
 * `customerMap.get()` misses whenever the customer sits beyond the 5,000-record
 * cap or has been deleted, and the page rendered the literal string 'Unknown'
 * — indistinguishable from a customer actually called Unknown, and still
 * wrapped in a link to a record that may not exist. Missing is now its own
 * state so the row can say so and withhold the link.
 */
export function buildFeedRows(
  activities: Activity[],
  customers: Map<string, CustomerItem>,
): FeedRow[] {
  return activities.map(a => {
    const c = customers.get(a.customerId)
    const meta = ACTIVITY_TYPES.find(t => t.value === a.type)
    return {
      ...a,
      customerName: c ? (fullName(c).trim() || 'Unnamed record') : null,
      customerMissing: !c,
      // Was `?? ACTIVITY_TYPES[4]`, a magic index into the array — a sixth
      // type, or any reordering, silently displayed a confidently wrong label.
      typeLabel: meta ? meta.label : null,
    }
  })
}

export function matchesActivityQuery(row: FeedRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    (row.customerName ?? '').toLowerCase().includes(q) ||
    row.note.toLowerCase().includes(q) ||
    row.userName.toLowerCase().includes(q) ||
    (row.typeLabel ?? row.type).toLowerCase().includes(q)
  )
}

export function filterFeed(
  rows: FeedRow[], filter: ActivityFilter, query: string,
): FeedRow[] {
  const byType = filter === 'all' ? rows : rows.filter(r => r.type === filter)
  const q = query.trim()
  return q ? byType.filter(r => matchesActivityQuery(r, q)) : byType
}

/**
 * Counts per type for the filter chips.
 *
 * Computed over the *searched* set, not the whole feed: the chips previously
 * read from the unfiltered list, so typing a search narrowed the rows while
 * every chip kept showing its original count.
 */
export function typeCounts(rows: FeedRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1
  return counts
}

/** Rows matching the search but before the type filter — what the chips count. */
export function searchedRows(rows: FeedRow[], query: string): FeedRow[] {
  const q = query.trim()
  return q ? rows.filter(r => matchesActivityQuery(r, q)) : rows
}

export function groupFeedByDay(rows: FeedRow[], now: Date = new Date()): DayGroup<FeedRow>[] {
  return groupByDay(rows, r => r.createdAt, now)
}

/**
 * Relative time for a feed row.
 *
 * The day is in the group heading, so this only needs to distinguish rows
 * inside one day — but it keeps a date for anything older in case a row is
 * ever rendered outside a group.
 */
export function timeAgo(d: Date, now: Date = new Date()): string {
  const diff = now.getTime() - d.getTime()
  if (diff < 0) return 'Just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtTimeOfDay(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
