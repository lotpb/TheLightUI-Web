export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'

export interface ProposalLineItem {
  description: string
  qty: number
  rate: number
}

export interface Proposal {
  id: string
  companyId: string
  shareToken?: string
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  proposalNumber: string
  issueDate: Date
  expiresDate: Date
  status: ProposalStatus
  lineItems: ProposalLineItem[]
  notes: string
  taxRate: number
  createdAt: Date
  updatedAt: Date
  respondedAt?: Date | null
  convertedInvoiceId?: string | null
  lastReminderSentAt?: Date | null
}

export function lineItemTotal(item: ProposalLineItem): number {
  return item.qty * item.rate
}

export function proposalSubtotal(p: Pick<Proposal, 'lineItems'>): number {
  return p.lineItems.reduce((sum, l) => sum + lineItemTotal(l), 0)
}

export function proposalTaxAmount(p: Pick<Proposal, 'lineItems' | 'taxRate'>): number {
  return proposalSubtotal(p) * (p.taxRate / 100)
}

export function proposalTotal(p: Pick<Proposal, 'lineItems' | 'taxRate'>): number {
  return proposalSubtotal(p) + proposalTaxAmount(p)
}

// A 'sent' proposal past its expiry date is treated as expired everywhere in
// the UI without needing a scheduled function to flip the stored status.
export function effectiveStatus(p: Proposal): ProposalStatus {
  if (p.status !== 'sent') return p.status
  const now = new Date(); now.setHours(0, 0, 0, 0)
  if (p.expiresDate < now) return 'expired'
  return p.status
}

export function statusLabel(s: ProposalStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function statusClasses(s: ProposalStatus): string {
  switch (s) {
    case 'accepted': return 'text-green-400 bg-green-500/10 border-green-700/30'
    case 'declined': return 'text-red-400 bg-red-500/10 border-red-700/30'
    case 'sent':      return 'text-blue-400 bg-blue-500/10 border-blue-700/30'
    case 'expired':  return 'text-amber-400 bg-amber-500/10 border-amber-700/30'
    default:          return 'text-gray-400 bg-gray-700/40 border-gray-600/30'
  }
}

export function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

export function generateProposalNumber(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const r = Math.floor(Math.random() * 9000 + 1000)
  return `PROP-${y}${m}-${r}`
}
