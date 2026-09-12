import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, orderBy, limit, writeBatch,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Campaign, CampaignRecipient } from '../models/campaign'
import type { CustomerItem } from '../models/customer'

const CAMP_COL = 'campaigns'
const RCPT_COL = 'campaignRecipients'

// Safety cap for a single campaign's recipient list — a large blast could
// otherwise load thousands of recipient docs into one listener at once.
const RECIPIENT_REALTIME_LIMIT = 5_000

function toDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function toCampaign(id: string, d: Record<string, unknown>): Campaign {
  return {
    id,
    companyId: String(d['companyId'] ?? ''),
    name:      String(d['name']      ?? ''),
    subject:   String(d['subject']   ?? ''),
    body:      String(d['body']      ?? ''),
    segment:   (d['segment'] as Campaign['segment']) ?? { categories: [], salesmen: [] },
    status:    (d['status'] as Campaign['status'])   ?? 'draft',
    sentAt:    d['sentAt']    ? toDate(d['sentAt'])    : null,
    sentCount: Number(d['sentCount']  ?? 0),
    failedCount: Number(d['failedCount'] ?? 0),
    openCount: Number(d['openCount']  ?? 0),
    clickCount:Number(d['clickCount'] ?? 0),
    createdAt: toDate(d['createdAt']),
    updatedAt: toDate(d['updatedAt']),
  }
}

function toRecipient(id: string, d: Record<string, unknown>): CampaignRecipient {
  return {
    id,
    campaignId:    String(d['campaignId']    ?? ''),
    companyId:     String(d['companyId']     ?? ''),
    customerId:    String(d['customerId']    ?? ''),
    customerName:  String(d['customerName']  ?? ''),
    customerEmail: String(d['customerEmail'] ?? ''),
    status:        (d['status'] as CampaignRecipient['status']) ?? 'sent',
    sentAt:        toDate(d['sentAt']),
    openedAt:      d['openedAt']  ? toDate(d['openedAt'])  : null,
    clickedAt:     d['clickedAt'] ? toDate(d['clickedAt']) : null,
  }
}

export function subscribeToCampaigns(
  onData:  (items: Campaign[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId) { onData([]); return () => {} }

  const q = query(
    collection(db, CAMP_COL),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
  )

  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toCampaign(d.id, d.data()))),
    onError,
  )
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const snap = await getDoc(doc(db, CAMP_COL, id))
  if (!snap.exists()) return null
  return toCampaign(snap.id, snap.data() as Record<string, unknown>)
}

export async function createCampaign(
  fields: Pick<Campaign, 'name' | 'subject' | 'body' | 'segment'>,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')
  const ref = await addDoc(collection(db, CAMP_COL), {
    companyId,
    ...fields,
    status:     'draft',
    sentAt:     null,
    sentCount:  0,
    failedCount: 0,
    openCount:  0,
    clickCount: 0,
    createdAt:  serverTimestamp(),
    updatedAt:  serverTimestamp(),
  })
  return ref.id
}

export async function updateCampaign(
  id: string,
  fields: Partial<Pick<Campaign, 'name' | 'subject' | 'body' | 'segment'>>,
): Promise<void> {
  await updateDoc(doc(db, CAMP_COL, id), { ...fields, updatedAt: serverTimestamp() })
}

export async function deleteCampaign(id: string): Promise<void> {
  await deleteDoc(doc(db, CAMP_COL, id))
}

/**
 * Queues the audience, then asks the server to send it.
 *
 * This used to write every recipient row as `status: 'sent'`, stamp the
 * campaign sent with a sentCount, and return — with no mail provider call
 * anywhere in the client, and no Cloud Function or trigger behind it. The
 * page reported a successful send and nothing left the system.
 *
 * Rows are written 'pending' here (batched, because a large audience exceeds
 * Firestore's 500-write limit), and sendCampaignEmails moves each to sent or
 * bounced as the provider answers. The campaign's own status and sentCount
 * are set by that function, from what was actually accepted.
 */
export async function queueCampaignRecipients(
  campaignId: string,
  recipients: CustomerItem[],
): Promise<number> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const CHUNK = 400
  let written = 0
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const c of recipients.slice(i, i + CHUNK)) {
      batch.set(doc(collection(db, RCPT_COL)), {
        campaignId,
        companyId,
        customerId:       c.id,
        customerName:     `${c.first} ${c.lastname}`.trim(),
        customerEmail:    c.email.trim(),
        // The merge fields the server substitutes, denormalised onto the row
        // so the send doesn't re-read every customer document.
        customerFirst:    c.first,
        customerLast:     c.lastname,
        customerPhone:    c.phone,
        customerCity:     c.city,
        customerSalesman: c.salesman,
        status:           'pending',
        sentAt:           null,
        openedAt:         null,
        clickedAt:        null,
      })
      written++
    }
    await batch.commit()
  }
  return written
}

export interface CampaignSendResult { sent: number; failed: number }

/** Calls sendCampaignEmails. Throws if the function isn't deployed. */
export async function sendCampaign(campaignId: string): Promise<CampaignSendResult> {
  const fns = getFunctions()
  const call = httpsCallable<{ campaignId: string }, CampaignSendResult>(fns, 'sendCampaignEmails')
  const res = await call({ campaignId })
  return res.data
}

export function subscribeToRecipients(
  campaignId: string,
  onData:  (items: CampaignRecipient[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, RCPT_COL),
    where('campaignId', '==', campaignId),
    orderBy('sentAt', 'asc'),
    limit(RECIPIENT_REALTIME_LIMIT),
  )
  return onSnapshot(
    q,
    snap => {
      if (snap.size === RECIPIENT_REALTIME_LIMIT) {
        console.warn(`[subscribeToRecipients] hit ${RECIPIENT_REALTIME_LIMIT}-document cap for campaign ${campaignId}.`)
      }
      onData(snap.docs.map(d => toRecipient(d.id, d.data())))
    },
    onError,
  )
}

// Which campaigns a single customer has received — shown on the customer
// record's Email tab so a rep can see blast history alongside 1:1 email.
export function subscribeToRecipientsByCustomer(
  customerId: string,
  onData:  (items: CampaignRecipient[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const companyId = getCompanyId()
  if (!companyId || !customerId) { onData([]); return () => {} }
  const q = query(
    collection(db, RCPT_COL),
    where('companyId', '==', companyId),
    where('customerId', '==', customerId),
  )
  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toRecipient(d.id, d.data()))),
    onError,
  )
}
