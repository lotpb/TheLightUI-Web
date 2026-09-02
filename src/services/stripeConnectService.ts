import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface StripeConnectStatus {
    connected: boolean
    accountId: string
    connectedAt: Date | null
}

const EMPTY_STATUS: StripeConnectStatus = { connected: false, accountId: '', connectedAt: null }

function statusDoc(companyId: string) {
    return doc(db, 'companies', companyId, 'settings', 'stripeConnectStatus')
}

function toDate(v: unknown): Date | null {
    if (v && typeof v === 'object' && 'toDate' in v) return (v as { toDate(): Date }).toDate()
    return null
}

export function subscribeToStripeConnectStatus(
    onData: (status: StripeConnectStatus) => void,
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
                connected:   d.connected === true,
                accountId:   typeof d.accountId === 'string' ? d.accountId : '',
                connectedAt: toDate(d.connectedAt),
            })
        },
        onError,
    )
}

export async function connectStripe(): Promise<string> {
    const fn = httpsCallable<Record<string, never>, { url: string }>(getFunctions(), 'stripeConnectStart')
    const result = await fn({})
    return result.data.url
}

export async function disconnectStripe(): Promise<void> {
    const fn = httpsCallable(getFunctions(), 'stripeConnectDisconnect')
    await fn({})
}
