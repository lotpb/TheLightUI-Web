import type { DocTemplateKind, DocSection } from './docTemplate'

export type SigningStatus = 'pending' | 'signed'

export interface SigningDocSnapshot {
  templateName:   string
  templateKind:   DocTemplateKind
  intro:          string
  sections:       DocSection[]
  closing:        string
  companyName:    string
  companyAddress: string
  companyPhone:   string
  companyEmail:   string
  customerName:   string
  customerEmail:  string
  customerPhone:  string
  customerStreet: string
  customerCity:   string
  customerState:  string
  customerZip:    string
}

export interface SigningRequest {
  id:               string  // UUID = Firestore doc ID = signing token
  companyId:        string
  templateId:       string
  customerId:       string
  document:         SigningDocSnapshot
  status:           SigningStatus
  createdAt:        Date
  signedAt:         Date | null
  signatureDataUrl: string | null
  signerName:       string | null
}

export const STATUS_LABELS: Record<SigningStatus, string> = {
  pending: 'Pending',
  signed:  'Signed',
}

export const STATUS_COLORS: Record<SigningStatus, string> = {
  pending: 'bg-yellow-500/15 text-yellow-300',
  signed:  'bg-green-500/15 text-green-300',
}
