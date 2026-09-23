import {
  collection, doc, deleteDoc, getDocs, onSnapshot, query, setDoc,
  Timestamp, where, writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import {
  DEFAULT_CADENCES, LEGACY_CADENCE_KEY, LEGACY_POSITION_KEY,
  cadenceDocId, coerceSteps, readLegacy, startOfDay,
  type CadencePosition, type CadenceStep, type FollowUpCadence,
} from '../models/followUpCadence'

/**
 * Storage for /followups' reminder cadences.
 *
 * Separate collections from `sequences` / `sequenceEnrollments`, which belong
 * to the engine that actually sends. See models/followUpCadence for why the two
 * are kept apart.
 */
const CADENCES = 'followUpCadences'
const POSITIONS = 'followUpCadencePositions'

// ── Cadences ──────────────────────────────────────────────────────────────────

export function subscribeToCadences(
  onData: (cadences: FollowUpCadence[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  // No orderBy: a document written before `createdAt` existed would be dropped
  // from the result entirely. Sorted client-side by name instead, which is also
  // the order the list reads best in.
  return onSnapshot(
    query(collection(db, CADENCES), where('companyId', '==', companyId)),
    snap => {
      const items = snap.docs.map(d => {
        const raw = d.data()
        return {
          id: String(raw['cadenceId'] ?? d.id),
          companyId: String(raw['companyId'] ?? ''),
          name: String(raw['name'] ?? ''),
          steps: coerceSteps(raw['steps']),
          createdAt: (raw['createdAt'] as Timestamp | undefined)?.toDate() ?? new Date(0),
        }
      })
      items.sort((a, b) => a.name.localeCompare(b.name))
      onData(items)
    },
    onError,
  )
}

export async function saveCadence(
  cadenceId: string, name: string, steps: CadenceStep[],
): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await setDoc(
    doc(db, CADENCES, cadenceDocId(companyId, cadenceId)),
    {
      companyId,
      cadenceId,
      name: name.trim(),
      steps,
      createdAt: Timestamp.fromDate(new Date()),
    },
    // merge, so editing an existing cadence keeps its original createdAt
    { merge: true },
  )
}

export async function deleteCadence(cadenceId: string): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await deleteDoc(doc(db, CADENCES, cadenceDocId(companyId, cadenceId)))
}

// ── Positions ─────────────────────────────────────────────────────────────────

export function subscribeToCadencePositions(
  onData: (byCustomerId: Record<string, CadencePosition>) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData({}); return () => {} }

  return onSnapshot(
    query(collection(db, POSITIONS), where('companyId', '==', companyId)),
    snap => {
      const out: Record<string, CadencePosition> = {}
      for (const d of snap.docs) {
        const raw = d.data()
        out[d.id] = {
          customerId: d.id,
          companyId: String(raw['companyId'] ?? ''),
          cadenceId: String(raw['cadenceId'] ?? ''),
          startDate: (raw['startDate'] as Timestamp | undefined)?.toDate() ?? new Date(0),
          stepIndex: Number(raw['stepIndex'] ?? 0),
          updatedAt: (raw['updatedAt'] as Timestamp | undefined)?.toDate() ?? new Date(0),
        }
      }
      onData(out)
    },
    onError,
  )
}

/** The document id is the customer id, so there's one position per customer. */
export async function setCadencePosition(
  customerId: string, cadenceId: string, startDate: Date, stepIndex: number,
): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await setDoc(doc(db, POSITIONS, customerId), {
    companyId,
    cadenceId,
    startDate: Timestamp.fromDate(startOfDay(startDate)),
    stepIndex,
    updatedAt: Timestamp.fromDate(new Date()),
  })
}

export async function clearCadencePosition(customerId: string): Promise<void> {
  await deleteDoc(doc(db, POSITIONS, customerId))
}

// ── Seed and migration ────────────────────────────────────────────────────────

/**
 * Brings a company's cadences into Firestore, once.
 *
 * Three things have to be true for this to be safe to call on every page load,
 * which is the only place it can be called from:
 *
 *   - Seeding the defaults is keyed on `cadenceDocId`, so the ids are stable
 *     and a second run writes the same three documents rather than three more.
 *   - Only cadences this browser actually *customised* migrate. Otherwise every
 *     rep who never touched the built-ins would contribute three duplicates —
 *     readLegacy drops the untouched ones.
 *   - Positions migrate keyed on customer id, so two reps who both had a
 *     position for the same customer converge rather than duplicating.
 *
 * The legacy keys are removed only after the writes resolve, so a failure
 * halfway leaves the local data in place to be retried.
 */
export async function migrateAndSeedCadences(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage,
): Promise<{ seeded: number; migrated: number; positions: number }> {
  const companyId = getCompanyId()
  if (!companyId) return { seeded: 0, migrated: 0, positions: 0 }

  const legacy = readLegacy(k => storage.getItem(k))
  const existing = await getDocs(
    query(collection(db, CADENCES), where('companyId', '==', companyId)),
  )

  const batch = writeBatch(db)
  let seeded = 0
  let migrated = 0

  // Seed the built-ins only when the company has none at all — so a company
  // that has since deleted one doesn't have it reappear on the next load.
  if (existing.empty) {
    for (const def of DEFAULT_CADENCES) {
      batch.set(doc(db, CADENCES, cadenceDocId(companyId, def.id)), {
        companyId,
        cadenceId: def.id,
        name: def.name,
        steps: def.steps,
        createdAt: Timestamp.fromDate(new Date()),
      })
      seeded++
    }
  }

  for (const c of legacy.cadences) {
    batch.set(
      doc(db, CADENCES, cadenceDocId(companyId, c.id)),
      {
        companyId,
        cadenceId: c.id,
        name: c.name,
        steps: c.steps,
        createdAt: Timestamp.fromDate(new Date()),
      },
      { merge: true },
    )
    migrated++
  }

  for (const p of legacy.positions) {
    batch.set(doc(db, POSITIONS, p.customerId), {
      companyId,
      cadenceId: p.cadenceId,
      startDate: Timestamp.fromDate(startOfDay(p.startDate)),
      stepIndex: p.stepIndex,
      updatedAt: Timestamp.fromDate(new Date()),
    }, { merge: true })
  }

  if (seeded === 0 && migrated === 0 && legacy.positions.length === 0) {
    return { seeded: 0, migrated: 0, positions: 0 }
  }

  await batch.commit()

  // Only now, so a failed commit can be retried from the same local data.
  storage.removeItem(LEGACY_CADENCE_KEY)
  storage.removeItem(LEGACY_POSITION_KEY)

  return { seeded, migrated, positions: legacy.positions.length }
}
