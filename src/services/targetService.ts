import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface PersonGoals {
  revenue: number
  leads: number
  customers: number
}

/** Keyed by salesman name, which is what the records themselves carry. */
export type GoalsMap = Record<string, PersonGoals>

export const DEFAULT_GOALS: PersonGoals = { revenue: 0, leads: 0, customers: 0 }

/**
 * Targets used to live only in localStorage, keyed by company.
 *
 * So a page titled "Targets", subtitled "{Salesman} goals and progress" and
 * laid out as a team leaderboard was in fact a private scratchpad: the goals an
 * owner set were invisible to the salespeople they were for, to the other
 * admins, and to the same owner on any other device or browser. The page
 * disclosed this at the very bottom in text-gray-600 — 1.94:1, the least
 * readable thing on it.
 *
 * These now live on the company document, reusing the existing
 * companies/{companyId}/settings/{settingId} rule that companyProfileService
 * already relies on: read for company members, write for anyone who isn't a
 * viewer. No security-rule change, so nothing to deploy beyond the app.
 */
function targetsDoc(companyId: string) {
  return doc(db, 'companies', companyId, 'settings', 'targets')
}

const LEGACY_KEY_PREFIX = 'thelight.targets_'

/**
 * Whatever this browser already had.
 *
 * Same migration shape companyProfileService uses: the first person to open the
 * page after this ships keeps the goals they'd set locally, and the next save
 * promotes them to Firestore for the whole team.
 */
function localFallback(companyId: string): GoalsMap {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`${LEGACY_KEY_PREFIX}${companyId}`) ?? '{}')
    return parseGoals(raw)
  } catch {
    return {}
  }
}

function parseGoals(raw: unknown): GoalsMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: GoalsMap = {}
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const g = v as Record<string, unknown>
    out[name] = {
      revenue:   typeof g.revenue   === 'number' && Number.isFinite(g.revenue)   ? g.revenue   : 0,
      leads:     typeof g.leads     === 'number' && Number.isFinite(g.leads)     ? g.leads     : 0,
      customers: typeof g.customers === 'number' && Number.isFinite(g.customers) ? g.customers : 0,
    }
  }
  return out
}

export function subscribeToTargets(
  onData: (goals: GoalsMap) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData({}); return () => {} }
  return onSnapshot(
    targetsDoc(companyId),
    snap => {
      if (!snap.exists()) { onData(localFallback(companyId)); return }
      onData(parseGoals((snap.data() as Record<string, unknown>).goals))
    },
    onError,
  )
}

export async function saveTargets(goals: GoalsMap): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('No company')
  await setDoc(targetsDoc(companyId), { goals }, { merge: true })
}
