import { doc, getDoc, setDoc } from 'firebase/firestore'
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
