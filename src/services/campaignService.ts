import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, orderBy, writeBatch,
  serverTimestamp, Timestamp, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Campaign, CampaignRecipient } from '../models/campaign'
import type { CustomerItem } from '../models/customer'

const CAMP_COL = 'campaigns'
const RCPT_COL = 'campaignRecipients'

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
    segment:   (d['segment'] as Campaign['segment']) ?? { categories: [], salesmen: [], requireEmail: true },
    status:    (d['status'] as Campaign['status'])   ?? 'draft',
    sentAt:    d['sentAt']    ? toDate(d['sentAt'])    : null,
    sentCount: Number(d['sentCount']  ?? 0),
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

export async function sendCampaign(
  campaignId: string,
  recipients: CustomerItem[],
): Promise<number> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const now = Timestamp.now()
  const CHUNK = 400   // stay well under Firestore batch limit of 500

  // Write recipients in chunks
  let written = 0
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const chunk = recipients.slice(i, i + CHUNK)
    const batch = writeBatch(db)
    for (const c of chunk) {
      const ref = doc(collection(db, RCPT_COL))
      batch.set(ref, {
        campaignId,
        companyId,
        customerId:    c.id,
        customerName:  `${c.first} ${c.lastname}`.trim(),
        customerEmail: c.email,
        status:        'sent',
        sentAt:        now,
        openedAt:      null,
        clickedAt:     null,
      })
      written++
    }
    await batch.commit()
  }

  // Update campaign status
  await updateDoc(doc(db, CAMP_COL, campaignId), {
    status:    'sent',
    sentAt:    now,
    sentCount: written,
    updatedAt: serverTimestamp(),
  })

  return written
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
  )
  return onSnapshot(
    q,
    snap => onData(snap.docs.map(d => toRecipient(d.id, d.data()))),
    onError,
  )
}
