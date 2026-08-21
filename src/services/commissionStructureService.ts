import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface CommissionTier {
  upTo: number | null  // null = no cap (top tier, catches everything above)
  rate: number         // percentage 0-100
}

export interface CommissionStructure {
  mode: 'flat' | 'tiered'
  defaultRate: number
  tiers: CommissionTier[]
  overrides: Record<string, number>  // salesman-name → flat rate override
}

export const DEFAULT_STRUCTURE: CommissionStructure = {
  mode: 'flat',
  defaultRate: 10,
  tiers: [],
  overrides: {},
}

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

/**
 * Calculate commission for a salesman given their total revenue.
 * Priority: per-salesman override → tiered structure → flat default.
 * Tiered mode is threshold-based: revenue is compared to each tier's
 * upper bound and the entire revenue is rated at the matching tier's rate.
 */
export function calcCommission(
  revenue: number,
  structure: CommissionStructure,
  salesmanName: string,
): { commission: number; rate: number; isOverride: boolean } {
  if (structure.overrides[salesmanName] !== undefined) {
    const rate = structure.overrides[salesmanName]
    return { commission: revenue * (rate / 100), rate, isOverride: true }
  }
  if (structure.mode === 'flat' || structure.tiers.length === 0) {
    const rate = structure.defaultRate
    return { commission: revenue * (rate / 100), rate, isOverride: false }
  }
  const sorted = [...structure.tiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
  for (const tier of sorted) {
    if (tier.upTo === null || revenue <= tier.upTo) {
      return { commission: revenue * (tier.rate / 100), rate: tier.rate, isOverride: false }
    }
  }
  const last = sorted[sorted.length - 1]
  const rate  = last?.rate ?? structure.defaultRate
  return { commission: revenue * (rate / 100), rate, isOverride: false }
}
