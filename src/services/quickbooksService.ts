import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface QuickBooksStatus {
  connected: boolean
  realmId: string
  connectedAt: Date | null
}

const EMPTY_STATUS: QuickBooksStatus = { connected: false, realmId: '', connectedAt: null }

function statusDoc(companyId: string) {
  return doc(db, 'companies', companyId, 'settings', 'quickbooksStatus')
}

export function subscribeToQuickBooksStatus(
  onData: (status: QuickBooksStatus) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData(EMPTY_STATUS); return () => {} }
  return onSnapshot(
    statusDoc(companyId),
    snap => {
      if (!snap.exists()) { onData(EMPTY_STATUS); return }
      const d = snap.data() as Record<string, unknown>
      onData({
        connected: d.connected === true,
        realmId:   typeof d.realmId === 'string' ? d.realmId : '',
        connectedAt: d.connectedAt && typeof d.connectedAt === 'object' && 'toDate' in d.connectedAt
          ? (d.connectedAt as { toDate(): Date }).toDate()
          : null,
      })
    },
    onError,
  )
}

export async function connectQuickBooks(): Promise<string> {
  const fn = httpsCallable<Record<string, never>, { url: string }>(getFunctions(), 'quickbooksConnect')
  const result = await fn({})
  return result.data.url
}

export async function disconnectQuickBooks(): Promise<void> {
  const fn = httpsCallable(getFunctions(), 'quickbooksDisconnect')
  await fn({})
}

export async function pushInvoiceToQuickBooks(invoiceId: string): Promise<string> {
  const fn = httpsCallable<{ invoiceId: string }, { quickbooksInvoiceId: string }>(getFunctions(), 'pushInvoiceToQuickBooks')
  const result = await fn({ invoiceId })
  return result.data.quickbooksInvoiceId
}
