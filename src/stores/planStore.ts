import { create } from 'zustand'
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuthStore } from './authStore'
import { parsePlan, effectivePlan, type Plan } from '../models/plan'

interface PlanState {
  /** The stored plan, or null when the company has none assigned yet. */
  assigned: Plan | null
  /** What features are checked against — unassigned means full access. */
  plan: Plan
  /** True until the company doc's first snapshot (or an error) arrives. */
  loading: boolean
}

export const usePlanStore = create<PlanState>(() => ({
  assigned: null,
  plan: effectivePlan(null),
  loading: true,
}))

// One listener on companies/{companyId}, swapped whenever the signed-in
// company changes. Driven from the auth store rather than a component so the
// plan is known before the first gated page renders, and so the sidebar,
// launcher, search and route guard all share it instead of each opening
// their own listener.
let unsub: Unsubscribe | null = null
let watchedCompanyId: string | null = null

function watch(companyId: string | null) {
  if (companyId === watchedCompanyId) return
  unsub?.()
  unsub = null
  watchedCompanyId = companyId
  usePlanStore.setState({ assigned: null, plan: effectivePlan(null), loading: !!companyId })
  if (!companyId) return
  unsub = onSnapshot(
    doc(db, 'companies', companyId),
    snap => {
      const assigned = parsePlan(snap.exists() ? snap.data()['plan'] : null)
      usePlanStore.setState({ assigned, plan: effectivePlan(assigned), loading: false })
    },
    // Fail open: a read error (e.g. rules not yet deployed) leaves the
    // company on full access rather than hiding features it may be paying for.
    // This gate is a UI convenience; it is not a security boundary.
    err => {
      console.warn('[Plan] company doc unavailable:', err.message)
      usePlanStore.setState({ loading: false })
    },
  )
}

watch(useAuthStore.getState().companyId)
useAuthStore.subscribe(state => watch(state.companyId))
