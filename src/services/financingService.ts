import { collection, doc, limit, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import {
    sortFinancingApplications,
    type FinancingApplication as FinancingApplicationRow,
    type FinancingSourceType as SourceType,
} from '../models/financingApplication'

export interface FinancingStatus {
    connected: boolean
    merchantName: string
    sandbox: boolean
    connectedAt: Date | null
    /**
     * Whether the provider has actually accepted the stored key.
     *
     * `connected` only ever meant "a key was saved" — connectFinancing checked
     * that the field was non-empty and wrote connected: true. These three
     * fields are what let the page tell a working connection from a stored
     * string.
     */
    verified: boolean
    verificationError: string
    verifiedAt: Date | null
    /** Last four characters, so the page can say which key is stored. */
    keyTail: string
}

const EMPTY_STATUS: FinancingStatus = {
    connected: false, merchantName: '', sandbox: false, connectedAt: null,
    verified: false, verificationError: '', verifiedAt: null, keyTail: '',
}

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
                verified:     d.verified === true,
                verificationError: typeof d.verificationError === 'string' ? d.verificationError : '',
                verifiedAt:   toDate(d.verifiedAt),
                keyTail:      typeof d.keyTail === 'string' ? d.keyTail : '',
            })
        },
        onError,
    )
}

export interface FinancingVerifyResult {
    verified: boolean
    message: string
}

export async function connectFinancing(
    apiKey: string, merchantName: string, sandbox: boolean,
): Promise<FinancingVerifyResult> {
    const fn = httpsCallable<
        { apiKey: string; merchantName: string; sandbox: boolean },
        { success: boolean; verified: boolean; message: string }
    >(getFunctions(), 'connectFinancing')
    const res = await fn({ apiKey, merchantName, sandbox })
    return { verified: res.data.verified === true, message: res.data.message ?? '' }
}

/** Re-checks the stored key without disconnecting. */
export async function verifyFinancingConnection(): Promise<FinancingVerifyResult> {
    const fn = httpsCallable<Record<string, never>, { verified: boolean; message: string }>(
        getFunctions(), 'verifyFinancingConnection',
    )
    const res = await fn({})
    return { verified: res.data.verified === true, message: res.data.message ?? '' }
}

/** Switches sandbox/live without destroying the stored key. */
export async function setFinancingMode(sandbox: boolean): Promise<FinancingVerifyResult> {
    const fn = httpsCallable<{ sandbox: boolean }, { success: boolean; verified: boolean; message: string }>(
        getFunctions(), 'updateFinancingMode',
    )
    const res = await fn({ sandbox })
    return { verified: res.data.verified === true, message: res.data.message ?? '' }
}

export async function disconnectFinancing(): Promise<void> {
    const fn = httpsCallable(getFunctions(), 'disconnectFinancing')
    await fn({})
}

/**
 * Every application for this company.
 *
 * Firestore rules already allow a company-scoped `list` here; nothing was
 * using it. No orderBy — that would need a composite index and would exclude
 * any document missing createdAt — so the sort happens in the model.
 */
const APPLICATION_LIMIT = 500

export function subscribeToFinancingApplications(
    onData: (apps: FinancingApplicationRow[], hitCap: boolean) => void,
    onError: (err: Error) => void,
): Unsubscribe {
    const companyId = getCompanyId()
    if (!companyId) { onData([], false); return () => {} }
    return onSnapshot(
        query(
            collection(db, 'financingApplications'),
            where('companyId', '==', companyId),
            limit(APPLICATION_LIMIT),
        ),
        snap => {
            const rows: FinancingApplicationRow[] = snap.docs.map(d => {
                const v = d.data() as Record<string, unknown>
                return {
                    id: d.id,
                    sourceType: v.sourceType === 'invoice' ? 'invoice' : 'proposal',
                    sourceId: typeof v.sourceId === 'string' ? v.sourceId : '',
                    // Applications created before this field was denormalised
                    // have no name; the row shows an em dash rather than blank.
                    customerName: typeof v.customerName === 'string' ? v.customerName : '',
                    amount: Number(v.amount) || 0,
                    status: typeof v.status === 'string' ? v.status : 'created',
                    applyUrl: typeof v.applyUrl === 'string' ? v.applyUrl : '',
                    createdAt: toDate(v.createdAt),
                    updatedAt: toDate(v.updatedAt),
                }
            })
            onData(sortFinancingApplications(rows), snap.size === APPLICATION_LIMIT)
        },
        onError,
    )
}

export type FinancingSourceType = SourceType

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
