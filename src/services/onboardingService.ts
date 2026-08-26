import {
  collection, query, where, getCountFromServer,
  doc, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface OnboardingProgress {
  firstRecord: boolean
  inviteTeam: boolean
  firstDocument: boolean
}

// One-time aggregate counts (no document downloads) rather than realtime
// listeners — an onboarding checklist doesn't need to update mid-session,
// and this avoids piling yet another live subscription onto the Dashboard.
export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  const companyId = getCompanyId()
  if (!companyId) return { firstRecord: false, inviteTeam: false, firstDocument: false }

  const [customersCount, usersCount, invoicesCount, proposalsCount] = await Promise.all([
    getCountFromServer(query(collection(db, 'Customers'), where('companyId', '==', companyId))),
    getCountFromServer(query(collection(db, 'users'), where('companyId', '==', companyId))),
    getCountFromServer(query(collection(db, 'Invoices'), where('companyId', '==', companyId))),
    getCountFromServer(query(collection(db, 'Proposals'), where('companyId', '==', companyId))),
  ])

  return {
    firstRecord:   customersCount.data().count > 0,
    inviteTeam:    usersCount.data().count > 1, // >1 because the signed-up owner is already a member
    firstDocument: invoicesCount.data().count > 0 || proposalsCount.data().count > 0,
  }
}

// Reuses the existing companies/{companyId}/settings/{settingId} Firestore
// rule (already company-scoped, viewer-blocked) — no rule changes needed.
function onboardingDoc(companyId: string) {
  return doc(db, 'companies', companyId, 'settings', 'onboarding')
}

export async function isOnboardingDismissed(): Promise<boolean> {
  const companyId = getCompanyId()
  if (!companyId) return true
  const snap = await getDoc(onboardingDoc(companyId))
  return snap.exists() && snap.data().dismissed === true
}

export async function dismissOnboarding(): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) return
  await setDoc(onboardingDoc(companyId), { dismissed: true, dismissedAt: serverTimestamp() }, { merge: true })
}
