import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface CompanyProfile {
  name: string
  address: string
  phone: string
  email: string
}

export const EMPTY_PROFILE: CompanyProfile = { name: '', address: '', phone: '', email: '' }

const LOCAL_KEYS: Record<keyof CompanyProfile, string> = {
  name:    'thelight.co.name',
  address: 'thelight.co.address',
  phone:   'thelight.co.phone',
  email:   'thelight.co.email',
}

// Company name/address/phone/email used to live only in localStorage, so
// every browser/device showed different (or blank) info on the same
// invoice/proposal/quote. Falling back to whatever was already saved on
// *this* device means the first person to load the app after this shipped
// doesn't lose their existing info — the next save persists it to Firestore
// for the whole team.
function localFallback(): CompanyProfile {
  return {
    name:    localStorage.getItem(LOCAL_KEYS.name)    ?? '',
    address: localStorage.getItem(LOCAL_KEYS.address) ?? '',
    phone:   localStorage.getItem(LOCAL_KEYS.phone)   ?? '',
    email:   localStorage.getItem(LOCAL_KEYS.email)   ?? '',
  }
}

// Reuses the existing companies/{companyId}/settings/{settingId} Firestore
// rule (already company-scoped, viewer-blocked) — no rule changes needed.
function profileDoc(companyId: string) {
  return doc(db, 'companies', companyId, 'settings', 'profile')
}

export function subscribeToCompanyProfile(
  onData: (profile: CompanyProfile) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData(localFallback()); return () => {} }
  return onSnapshot(
    profileDoc(companyId),
    snap => {
      if (!snap.exists()) { onData(localFallback()); return }
      const d = snap.data() as Record<string, unknown>
      onData({
        name:    typeof d.name    === 'string' ? d.name    : '',
        address: typeof d.address === 'string' ? d.address : '',
        phone:   typeof d.phone   === 'string' ? d.phone   : '',
        email:   typeof d.email   === 'string' ? d.email   : '',
      })
    },
    onError,
  )
}

export async function saveCompanyProfile(profile: CompanyProfile): Promise<void> {
  const companyId = getCompanyId()
  if (!companyId) return
  await setDoc(profileDoc(companyId), profile, { merge: true })
}
