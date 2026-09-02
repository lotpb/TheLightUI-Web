import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface FinancingStatus {
    connected: boolean
    merchantName: string
    sandbox: boolean
    connectedAt: Date | null
}

const EMPTY_STATUS: FinancingStatus = { connected: false, merchantName: '', sandbox: false, connectedAt: null }

function statusDoc(companyId: string) {
    return doc(db, 'companies', companyId, 'settings', 'financingStatus')
}

function toDate(v: unknown): Date | null {
    if (v && typeof v === 'object' && 'toDate' in v) return (v as { toDate(): Date }).toDate()
    return null
}

export function subscribeToFinancingStatus(
    onData: (status: FinancingStatus) => void,
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
                connected:    d.connected === true,
                merchantName: typeof d.merchantName === 'string' ? d.merchantName : '',
                sandbox:      d.sandbox === true,
                connectedAt:  toDate(d.connectedAt),
            })
        },
        onError,
    )
}

export async function connectFinancing(apiKey: string, merchantName: string, sandbox: boolean): Promise<void> {
    const fn = httpsCallable(getFunctions(), 'connectFinancing')
    await fn({ apiKey, merchantName, sandbox })
}

export async function disconnectFinancing(): Promise<void> {
    const fn = httpsCallable(getFunctions(), 'disconnectFinancing')
    await fn({})
}

export type FinancingSourceType = 'proposal' | 'invoice'

export async function createFinancingApplication(
    sourceType: FinancingSourceType,
    sourceId: string,
): Promise<{ applicationId: string; applyUrl: string }> {
    const fn = httpsCallable<
        { sourceType: FinancingSourceType; sourceId: string },
        { applicationId: string; applyUrl: string }
    >(getFunctions(), 'createFinancingApplication')
    const result = await fn({ sourceType, sourceId })
    return result.data
}

export interface FinancingApplication {
    id: string
    status: string
    applyUrl: string
    amount: number
}

/** Live status for the staff detail-page card, keyed by the id stored on the source doc. */
export function subscribeToFinancingApplication(
    applicationId: string,
    onData: (app: FinancingApplication | null) => void,
    onError: (err: Error) => void,
): Unsubscribe {
    return onSnapshot(
        doc(db, 'financingApplications', applicationId),
        snap => {
            if (!snap.exists()) { onData(null); return }
            const d = snap.data() as Record<string, unknown>
            onData({
                id: snap.id,
                status: typeof d.status === 'string' ? d.status : 'created',
                applyUrl: typeof d.applyUrl === 'string' ? d.applyUrl : '',
                amount: Number(d.amount) || 0,
            })
        },
        onError,
    )
}
