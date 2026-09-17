import { doc, getDoc, onSnapshot, setDoc, Timestamp, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { resolveGoalTargets, type GoalDoc, type GoalValues } from '../models/goal'

const COLLECTION = 'Goals'

function tsToDate(ts: unknown): Date {
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  return new Date()
}

/**
 * Reads a stored document. The instance-vs-legacy resolution lives in
 * models/goal.ts (resolveGoalTargets), where it's under test.
 */
function parseGoalDoc(companyId: string, d: Record<string, unknown>): GoalDoc {
  return {
    companyId,
    ...resolveGoalTargets(d),
    updatedAt: tsToDate(d['updatedAt']),
  }
}

export async function getGoals(): Promise<GoalDoc | null> {
  const companyId = getCompanyId()
  if (!companyId) return null

  const snap = await getDoc(doc(db, COLLECTION, companyId))
  if (!snap.exists()) return null
  return parseGoalDoc(companyId, snap.data() as Record<string, unknown>)
}

/**
 * Live targets.
 *
 * The page read them once with getDoc, so it never saw a colleague's change —
 * and then wrote the whole document back, destroying it. The listener makes
 * the page notice; the per-period write below is what stops it clobbering.
 */
export function subscribeToGoals(
  onData: (goals: GoalDoc | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData(null); return () => {} }

  return onSnapshot(
    doc(db, COLLECTION, companyId),
    snap => onData(
      snap.exists() ? parseGoalDoc(companyId, snap.data() as Record<string, unknown>) : null,
    ),
    onError,
  )
}

/**
 * Writes the targets for one period instance.
 *
 * saveGoals used to `setDoc` the whole document — all three periods out of
 * local state, no merge — so two managers editing different periods silently
 * clobbered one another and the last save always won with no indication. A
 * merge write against a single `periods.{key}` field touches nothing else.
 */
export async function saveGoalsForPeriod(periodKey: string, values: GoalValues): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  await setDoc(
    doc(db, COLLECTION, companyId),
    {
      companyId,
      periods: { [periodKey]: values },
      updatedAt: Timestamp.now(),
    },
    { merge: true },
  )
}
