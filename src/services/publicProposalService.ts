import {
  doc, getDoc, setDoc, updateDoc, Timestamp, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { getCompanyId } from '../stores/authStore'
import type { Proposal, ProposalLineItem } from '../models/proposal'

const PUBLIC_COL = 'publicProposals'

export interface PublicCoInfo {
  name: string
  address: string
  phone: string
  email: string
}

export interface PublicProposalSnapshot {
  proposalId: string
  companyId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  proposalNumber: string
  issueDate: Date
  expiresDate: Date
  status: string
  lineItems: ProposalLineItem[]
  notes: string
  taxRate: number
  coName: string
  coAddress: string
  coPhone: string
  coEmail: string
  sharedAt: Date
}

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && 'toDate' in v) {
    return (v as { toDate(): Date }).toDate()
  }
  return new Date()
}

// Creates or refreshes the public snapshot. Returns the share token.
export async function generateShareToken(
  proposal: Proposal,
  coInfo: PublicCoInfo,
): Promise<string> {
  const companyId = getCompanyId()
  if (!companyId) throw new Error('Not authenticated')

  const token = proposal.shareToken ?? crypto.randomUUID()

  await setDoc(doc(db, PUBLIC_COL, token), {
    proposalId:      proposal.id,
    companyId,
    customerName:    proposal.customerName,
    customerPhone:   proposal.customerPhone,
    customerEmail:   proposal.customerEmail,
    customerAddress: proposal.customerAddress,
    proposalNumber:  proposal.proposalNumber,
    issueDate:   Timestamp.fromDate(proposal.issueDate),
    expiresDate: Timestamp.fromDate(proposal.expiresDate),
    status:      proposal.status,
    lineItems:   proposal.lineItems,
    notes:       proposal.notes,
    taxRate:     proposal.taxRate,
    coName:      coInfo.name,
    coAddress:   coInfo.address,
    coPhone:     coInfo.phone,
    coEmail:     coInfo.email,
    sharedAt:    serverTimestamp(),
  })

  if (!proposal.shareToken) {
    await updateDoc(doc(db, 'Proposals', proposal.id), { shareToken: token })
  }

  return token
}

export async function getPublicProposal(token: string): Promise<PublicProposalSnapshot | null> {
  const snap = await getDoc(doc(db, PUBLIC_COL, token))
  if (!snap.exists()) return null
  const d = snap.data() as Record<string, unknown>

  return {
    proposalId:      String(d.proposalId      ?? ''),
    companyId:       String(d.companyId       ?? ''),
    customerName:    String(d.customerName    ?? ''),
    customerPhone:   String(d.customerPhone   ?? ''),
    customerEmail:   String(d.customerEmail   ?? ''),
    customerAddress: String(d.customerAddress ?? ''),
    proposalNumber:  String(d.proposalNumber  ?? ''),
    issueDate:   toDate(d.issueDate),
    expiresDate: toDate(d.expiresDate),
    status:      String(d.status ?? 'sent'),
    lineItems: (Array.isArray(d.lineItems) ? d.lineItems as Record<string, unknown>[] : []).map(i => ({
      description: String(i.description ?? ''),
      qty:         Number(i.qty  ?? 1),
      rate:        Number(i.rate ?? 0),
    })),
    notes:    String(d.notes    ?? ''),
    taxRate:  Number(d.taxRate  ?? 0),
    coName:    String(d.coName    ?? ''),
    coAddress: String(d.coAddress ?? ''),
    coPhone:   String(d.coPhone   ?? ''),
    coEmail:   String(d.coEmail   ?? ''),
    sharedAt: toDate(d.sharedAt),
  }
}

// Customer clicks Accept/Decline on the public page. Firestore rules only
// allow this exact sent → accepted/declined transition for an unauthenticated
// caller; a Cloud Function trigger (onProposalResponse) then copies the
// result back onto the real Proposals doc for the company to see.
export async function respondToProposal(token: string, response: 'accepted' | 'declined'): Promise<void> {
  await updateDoc(doc(db, PUBLIC_COL, token), {
    status: response,
    respondedAt: serverTimestamp(),
  })
}
