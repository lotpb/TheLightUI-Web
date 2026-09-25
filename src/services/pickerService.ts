import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface PickerLabels {
  salesman: string
  job: string
  product: string
  advertiser: string
  contractor: string
}

export const DEFAULT_LABELS: PickerLabels = {
  salesman:   'Salesman',
  job:        'Job Type',
  product:    'Product',
  advertiser: 'Advertiser',
  contractor: 'Contractor',
}

export interface PickerLists {
  salesman: string[]
  job: string[]
  product: string[]
  advertiser: string[]
  contractor: string[]
  labels?: Partial<PickerLabels>
}

const REF = () => doc(db, 'companies', getCompanyId(), 'settings', 'pickerLists')

function safeStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

export async function fetchPickerLists(): Promise<PickerLists> {
  const snap = await getDoc(REF())
  if (!snap.exists()) return { salesman: [], job: [], product: [], advertiser: [], contractor: [] }
  const d = snap.data()
  return {
    salesman:   safeStrArr(d['salesman']),
    job:        safeStrArr(d['job']),
    product:    safeStrArr(d['product']),
    advertiser: safeStrArr(d['advertiser']),
    contractor: safeStrArr(d['contractor']),
    labels:     typeof d['labels'] === 'object' && d['labels'] !== null
                  ? (d['labels'] as Partial<PickerLabels>)
                  : undefined,
  }
}

export async function savePickerLists(lists: PickerLists): Promise<void> {
  await setDoc(REF(), lists)
}

const LIST_KEYS = ['salesman', 'job', 'product', 'advertiser', 'contractor'] as const

/**
 * Three-way merge of dropdown-list edits: applies what changed between `base`
 * (the lists as this page loaded them) and `mine` onto `theirs` (the lists as
 * they are now), instead of replacing theirs outright.
 *
 * Settings saved with a whole-document setDoc from the page's copy, so a
 * second admin's additions, or anything added while the page sat open, were
 * silently removed by the next save. Items this page removed are removed;
 * items it added are appended; everything else on the server stays, in its
 * order. A renamed list label wins only if this page changed it.
 */
export function mergePickerEdits(base: PickerLists, mine: PickerLists, theirs: PickerLists): PickerLists {
  const out: PickerLists = { salesman: [], job: [], product: [], advertiser: [], contractor: [] }
  for (const k of LIST_KEYS) {
    const b = base[k] ?? [], m = mine[k] ?? [], t = theirs[k] ?? []
    const removed = new Set(b.filter(x => !m.includes(x)))
    const kept = t.filter(x => !removed.has(x))
    out[k] = [...kept, ...m.filter(x => !b.includes(x) && !kept.includes(x))]
  }
  const labels: Partial<PickerLabels> = { ...theirs.labels }
  for (const k of LIST_KEYS) {
    const before = base.labels?.[k] ?? DEFAULT_LABELS[k]
    const after = mine.labels?.[k] ?? before
    if (after !== before) labels[k] = after
  }
  if (Object.keys(labels).length > 0) out.labels = labels
  return out
}

/** Saves Settings' list edits as a merge (see mergePickerEdits), atomically. */
export async function savePickerListEdits(base: PickerLists, mine: PickerLists): Promise<void> {
  const ref = REF()
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.exists() ? snap.data() : {}
    const theirs: PickerLists = {
      salesman:   safeStrArr(d['salesman']),
      job:        safeStrArr(d['job']),
      product:    safeStrArr(d['product']),
      advertiser: safeStrArr(d['advertiser']),
      contractor: safeStrArr(d['contractor']),
      labels:     typeof d['labels'] === 'object' && d['labels'] !== null
                    ? (d['labels'] as Partial<PickerLabels>)
                    : undefined,
    }
    // merge, so any other fields on the document are left alone.
    tx.set(ref, mergePickerEdits(base, mine, theirs), { merge: true })
  })
}
