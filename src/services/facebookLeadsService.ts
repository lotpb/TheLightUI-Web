import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'

export interface FacebookPageRef {
    id: string
    name: string
}

export interface FacebookStatus {
    connected: boolean
    connectedAt: Date | null
    fbUserName: string
    /** Every Page the connected account administers. */
    availablePages: FacebookPageRef[]
    /** Pages actively forwarding leads to this company. */
    subscribedPages: FacebookPageRef[]
    lastLeadAt: Date | null
    lastError: string
    lastErrorAt: Date | null
    /** Stored credentials stopped working; the user has to reconnect. */
    needsReauth: boolean
    userTokenExpiresAt: Date | null
}

const EMPTY_STATUS: FacebookStatus = {
    connected: false,
    connectedAt: null,
    fbUserName: '',
    availablePages: [],
    subscribedPages: [],
    lastLeadAt: null,
    lastError: '',
    lastErrorAt: null,
    needsReauth: false,
    userTokenExpiresAt: null,
}

function statusDoc(companyId: string) {
    return doc(db, 'companies', companyId, 'settings', 'facebookStatus')
}

function toDate(value: unknown): Date | null {
    if (value && typeof value === 'object' && 'toDate' in value) {
        return (value as { toDate(): Date }).toDate()
    }
    return null
}

function toPages(value: unknown): FacebookPageRef[] {
    if (!Array.isArray(value)) return []
    return value
        .map(raw => {
            const page = (raw ?? {}) as Record<string, unknown>
            return { id: String(page.id ?? ''), name: String(page.name ?? '') }
        })
        .filter(p => p.id)
}

export function subscribeToFacebookStatus(
    onData: (status: FacebookStatus) => void,
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
                connected:          d.connected === true,
                connectedAt:        toDate(d.connectedAt),
                fbUserName:         typeof d.fbUserName === 'string' ? d.fbUserName : '',
                availablePages:     toPages(d.availablePages),
                subscribedPages:    toPages(d.subscribedPages),
                lastLeadAt:         toDate(d.lastLeadAt),
                lastError:          typeof d.lastError === 'string' ? d.lastError : '',
                lastErrorAt:        toDate(d.lastErrorAt),
                needsReauth:        d.needsReauth === true,
                userTokenExpiresAt: toDate(d.userTokenExpiresAt),
            })
        },
        onError,
    )
}

export async function connectFacebook(): Promise<string> {
    const fn = httpsCallable<Record<string, never>, { url: string }>(getFunctions(), 'facebookConnect')
    const result = await fn({})
    return result.data.url
}

export async function setPageSubscription(pageId: string, subscribe: boolean): Promise<void> {
    const fn = httpsCallable<{ pageId: string; subscribe: boolean }, { success: boolean }>(
        getFunctions(), 'facebookSubscribePage',
    )
    await fn({ pageId, subscribe })
}

export async function disconnectFacebook(): Promise<void> {
    const fn = httpsCallable(getFunctions(), 'facebookDisconnect')
    await fn({})
}
