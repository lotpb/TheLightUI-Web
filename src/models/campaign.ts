import type { CustomerItem } from './customer'
import { fullName } from './customer'

export type CampaignStatus = 'draft' | 'sent'

export interface CampaignSegment {
  categories: string[]   // [] = all categories
  salesmen:   string[]   // [] = all salesmen
  requireEmail: true     // always true — we only email contacts with addresses
}

export interface Campaign {
  id: string
  companyId: string
  name: string
  subject: string
  body: string
  segment: CampaignSegment
  status: CampaignStatus
  sentAt: Date | null
  sentCount: number
  openCount: number
  clickCount: number
  createdAt: Date
  updatedAt: Date
}

export type RecipientStatus = 'sent' | 'opened' | 'clicked' | 'bounced'

export interface CampaignRecipient {
  id: string
  campaignId: string
  companyId: string
  customerId: string
  customerName: string
  customerEmail: string
  status: RecipientStatus
  sentAt: Date
  openedAt: Date | null
  clickedAt: Date | null
}

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
}

export const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: 'bg-gray-500/15 text-gray-400',
  sent: 'bg-green-500/15 text-green-300',
}

export const RECIPIENT_STATUS_COLORS: Record<RecipientStatus, string> = {
  sent:    'bg-blue-500/15 text-blue-300',
  opened:  'bg-teal-500/15 text-teal-300',
  clicked: 'bg-violet-500/15 text-violet-300',
  bounced: 'bg-red-500/15 text-red-400',
}

export const CAMPAIGN_MERGE_FIELDS = [
  { token: '{{firstName}}', desc: 'First name' },
  { token: '{{lastName}}',  desc: 'Last name' },
  { token: '{{fullName}}',  desc: 'Full name' },
  { token: '{{email}}',     desc: 'Email' },
  { token: '{{phone}}',     desc: 'Phone' },
  { token: '{{city}}',      desc: 'City' },
  { token: '{{salesman}}',  desc: 'Rep name' },
]

export function interpolateCampaign(body: string, c: CustomerItem): string {
  return body
    .replace(/{{firstName}}/g, c.first)
    .replace(/{{lastName}}/g,  c.lastname)
    .replace(/{{fullName}}/g,  fullName(c))
    .replace(/{{email}}/g,     c.email)
    .replace(/{{phone}}/g,     c.phone)
    .replace(/{{city}}/g,      c.city)
    .replace(/{{salesman}}/g,  c.salesman)
}

export function matchesSegment(c: CustomerItem, seg: CampaignSegment): boolean {
  if (!c.email) return false
  if (seg.categories.length > 0 && !seg.categories.some(cat => c.category.toLowerCase() === cat.toLowerCase())) return false
  if (seg.salesmen.length > 0 && !seg.salesmen.includes(c.salesman)) return false
  return true
}
