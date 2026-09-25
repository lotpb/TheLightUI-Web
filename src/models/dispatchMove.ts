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
