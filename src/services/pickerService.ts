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

export async function fetchPickerLists(): Promise<PickerLists> {
  const snap = await getDoc(REF())
  if (!snap.exists()) return { salesman: [], job: [], product: [], advertiser: [], contractor: [] }
  const d = snap.data()
  return {
    salesman:   (d['salesman']   as string[]) ?? [],
    job:        (d['job']        as string[]) ?? [],
    product:    (d['product']    as string[]) ?? [],
    advertiser: (d['advertiser'] as string[]) ?? [],
    contractor: (d['contractor'] as string[]) ?? [],
    labels:     (d['labels']     as Partial<PickerLabels> | undefined) ?? undefined,
  }
}

export async function savePickerLists(lists: PickerLists): Promise<void> {
  await setDoc(REF(), lists)
}
