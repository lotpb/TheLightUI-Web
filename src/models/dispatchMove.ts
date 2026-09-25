import { dayIndexInWeek } from './dispatchAssignment'

/**
 * Whether moving a visit to (uid, dayIndex) would change anything.
 *
 * Every visit is an 8am–5pm block on one day, so its slot on the board *is*
 * its tech and its start day. Dropping a card back on its own cell — the
 * ordinary way to abandon a drag — and pressing Move in the dialog, which
 * opens preset to the visit's current tech and day, both used to write the
 * visit and re-sync the job's start/completion onto the customer record, with
 * nothing visibly different afterwards. The same no-op move the two status
 * boards had, in the shape this board has.
 */
export function moveIsNoOp(
  a: { assignedToUid: string; startAt: Date },
  uid: string,
  dayIndex: number,
  weekStart: Date,
): boolean {
  return a.assignedToUid === uid && dayIndexInWeek(a.startAt, weekStart) === dayIndex
}

export interface ClockHandoff {
  /** Whose open entry on the job to close — the tech the visit is leaving. */
  clockOutUid: string | null
  /** Who to clock in on the job — the tech the visit is moving to. */
  clockInUid: string | null
}

/**
 * What reassigning a visit must do to the time clock, or null for nothing.
 *
 * Marking a visit in progress clocks its assigned tech in, and leaving
 * in_progress clocks out whoever is assigned *then*. Reassigning an
 * in-progress visit touched neither: the first tech's entry stayed open, and
 * the new tech's later "done" looked for an entry under their own uid, found
 * none, and closed nothing — so the first entry stayed open for good. An open
 * entry counts zero hours, so the job read short on labor, and the first tech
 * showed as clocked in on /timetracking indefinitely.
 *
 * The handoff mirrors what actually happens on site: the visit changes hands
 * at the moment of the move, so the old tech's hours stop there and the new
 * tech's start. Unassigned has nobody to clock, on either side. A day change
 * with the same tech needs nothing — their clock is still theirs.
 */
export function clockHandoffFor(
  a: { status: string; assignedToUid: string; customerId: string },
  newUid: string,
): ClockHandoff | null {
  if (a.status !== 'in_progress' || !a.customerId || newUid === a.assignedToUid) return null
  return { clockOutUid: a.assignedToUid || null, clockInUid: newUid || null }
}
