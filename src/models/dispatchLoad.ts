import { dayIndexInWeek, type DispatchAssignment } from './dispatchAssignment'

/**
 * Per-day load on the dispatch board, against the cap that closes the
 * customer portal.
 *
 * `maxVisitsPerDay` is edited on the dispatch board and consumed by the
 * `getPortalDayAvailability` callable, which marks a day full for the
 * customer booking form. The board itself showed no per-day count at all, so
 * a dispatcher could drag a sixth visit onto Thursday, close Thursday to
 * every customer on the portal, and get no indication.
 *
 * The rule below is copied from that function so the two can't disagree:
 * cancelled visits don't count, the count is company-wide across all techs,
 * and a day is full at `count >= cap` when the cap is above zero.
 */
export type DayLoadState = 'open' | 'full' | 'over'

export interface DayLoad {
  count: number
  /** 0 means no cap, matching `Number(...) || 0` on the server. */
  cap: number
  state: DayLoadState
}

/** Counts toward the cap. Mirrors `if (d['status'] === 'cancelled') continue`. */
export function countsTowardCap(a: Pick<DispatchAssignment, 'status'>): boolean {
  return a.status !== 'cancelled'
}

export function dayLoad(count: number, cap: number): DayLoad {
  const safeCap = cap > 0 ? cap : 0
  const state: DayLoadState = safeCap === 0
    ? 'open'
    : count > safeCap ? 'over'
    : count >= safeCap ? 'full'
    : 'open'
  return { count, cap: safeCap, state }
}

/**
 * One entry per day of the visible week, in the week's own order.
 *
 * Indexed by `dayIndexInWeek` rather than by date string so it agrees with
 * how the grid buckets its cells — a visit the grid draws on Tuesday is
 * counted on Tuesday.
 */
export function weekDayLoads(
  assignments: Pick<DispatchAssignment, 'status' | 'startAt'>[],
  weekStart: Date,
  cap: number,
  days = 7,
): DayLoad[] {
  const counts = new Array<number>(days).fill(0)
  for (const a of assignments) {
    if (!countsTowardCap(a)) continue
    const idx = dayIndexInWeek(a.startAt, weekStart)
    if (idx < 0 || idx >= days) continue
    counts[idx]++
  }
  return counts.map(n => dayLoad(n, cap))
}

/** How many visits sit in one cell, for the "+N more" collapse. */
export const CELL_VISIBLE_LIMIT = 4
