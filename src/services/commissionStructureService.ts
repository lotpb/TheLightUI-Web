import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import { DEFAULT_STRUCTURE, type CommissionStructure, type CommissionTier } from '../models/commission'

export { calcCommission, DEFAULT_STRUCTURE, type CommissionStructure, type CommissionTier } from '../models/commission'

const COL = 'commissionStructures'

export function subscribeToCommissionStructure(
  onData: (s: CommissionStructure) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) return () => {}
  return onSnapshot(doc(db, COL, companyId), snap => {
    if (!snap.exists()) { onData(DEFAULT_STRUCTURE); return }
    const d = snap.data() as Record<string, unknown>
    onData({
      mode:        d.mode === 'flat' || d.mode === 'tiered' ? d.mode : 'flat',
      defaultRate: typeof d.defaultRate === 'number' ? d.defaultRate : 10,
      tiers:       Array.isArray(d.tiers) ? d.tiers as CommissionTier[] : [],
      overrides:   d.overrides && typeof d.overrides === 'object' ? d.overrides as Record<string, number> : {},
    })
  })
}

export async function saveCommissionStructure(s: CommissionStructure): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) return
  await setDoc(doc(db, COL, companyId), s)
}
