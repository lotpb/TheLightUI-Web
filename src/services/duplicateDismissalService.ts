import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

/**
 * "Not a duplicate" decisions, shared across the company.
 *
 * These lived in `localStorage` under `duplicates_dismissed_{companyId}`, so a
 * judgement one person made was invisible to everyone else working the same
 * queue, didn't survive a second browser or device, and disappeared with
 * cleared site data — restoring every pair somebody had already ruled on.
 *
 * Stored on the existing companies/{companyId}/settings/{settingId} document,
 * which the Firestore rules already scope to the company and block viewers
 * from writing, so this needs no rule change.
 */
function dismissalDoc(companyId: string) {
  return doc(db, 'companies', companyId, 'settings', 'duplicateDismissals')
}

const LEGACY_KEY = (companyId: string) => `duplicates_dismissed_${companyId}`

/** Pair keys a previous version of the page left in this browser. */
export function readLegacyDismissals(companyId: string): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY(companyId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

export function clearLegacyDismissals(companyId: string): void {
  try { localStorage.removeItem(LEGACY_KEY(companyId)) } catch { /* private mode */ }
}

export function subscribeToDismissals(
  onData: (keys: Set<string>) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData(new Set()); return () => {} }

  return onSnapshot(
    dismissalDoc(companyId),
    snap => {
      const raw = snap.data()?.['keys']
      const keys = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
      onData(new Set(keys))
    },
    onError,
  )
}

export async function dismissPair(key: string): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  // arrayUnion rather than a read-modify-write, so two people dismissing
  // different pairs at the same time don't overwrite each other.
  await setDoc(dismissalDoc(companyId), { keys: arrayUnion(key) }, { merge: true })
}

export async function restorePair(key: string): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await setDoc(dismissalDoc(companyId), { keys: arrayRemove(key) }, { merge: true })
}

export async function restoreAllPairs(): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  await setDoc(dismissalDoc(companyId), { keys: [] }, { merge: true })
}

/** One-time migration of whatever this browser had stored locally. */
export async function migrateLegacyDismissals(): Promise<number> {
  const companyId = getCompanyId()
  if (!companyId) return 0
  const legacy = readLegacyDismissals(companyId)
  if (legacy.length === 0) return 0
  await setDoc(dismissalDoc(companyId), { keys: arrayUnion(...legacy) }, { merge: true })
  clearLegacyDismissals(companyId)
  return legacy.length
}
