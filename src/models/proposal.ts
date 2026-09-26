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
  financingApplicationId?: string | null
  /**
   * Share of the total collected up front when the customer accepts online,
   * 0–100. 0 or absent means no deposit — the accept flow is unchanged.
   */
  depositPercent?: number
  /**
   * What Stripe actually charged for the deposit, in dollars. Written only by
   * the Stripe webhook, from the session's amount_total — never recomputed
   * from depositPercent, because line items can be edited after payment.
   */
  depositPaidAmount?: number | null
  depositPaidAt?: Date | null
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

/**
 * The deposit owed on acceptance, rounded to the cent, or 0 for none.
 *
 * The same rounding runs server-side in createProposalDepositCheckout — keep
 * the two in step, or the page quotes one figure and Stripe charges another.
 */
export function proposalDepositAmount(p: Pick<Proposal, 'lineItems' | 'taxRate' | 'depositPercent'>): number {
  const pct = clampDepositPercent(p.depositPercent)
  if (pct === 0) return 0
  return Math.round(proposalTotal(p) * pct) / 100
}

/** Non-numbers, negatives and >100 all mean something went wrong upstream. */
export function clampDepositPercent(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, n)
}

// A 'sent' proposal past its expiry date is treated as expired everywhere in
// the UI without needing a scheduled function to flip the stored status.
export function effectiveStatus(p: Proposal, now: Date = new Date()): ProposalStatus {
  if (p.status !== 'sent') return p.status
  // Copied, not mutated: normalising the caller's clock to midnight in place
  // would skew every later proposal in a roll-up.
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  if (p.expiresDate < today) return 'expired'
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

// ── Expiry ────────────────────────────────────────────────────────────────────

/** How far ahead counts as "about to lapse". */
export const EXPIRING_SOON_DAYS = 7

/**
 * Whole days until a proposal lapses. Negative once it has.
 *
 * Measured from midnight, matching effectiveStatus: a proposal expiring today
 * is 0 days out and still live, not expired.
 */
export function daysUntilExpiry(
  p: Pick<Proposal, 'expiresDate'>,
  now: Date = new Date(),
): number {
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const end = new Date(p.expiresDate); end.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - today.getTime()) / 86_400_000)
}

/**
 * 'draft'    — no expiry meaning yet, it hasn't gone out
 * 'expiring' — live and lapsing within EXPIRING_SOON_DAYS
 * 'live'     — sent, with time left
 * 'expired'  — lapsed unanswered
 * 'closed'   — accepted or declined; the expiry date no longer applies
 *
 * The page showed "Expires Mar 3" on accepted rows, a date that stopped
 * meaning anything the moment the customer answered.
 */
export type ExpiryState = 'draft' | 'expiring' | 'live' | 'expired' | 'closed'

export function expiryState(p: Proposal, now: Date = new Date()): ExpiryState {
  const status = effectiveStatus(p, now)
  if (status === 'draft') return 'draft'
  if (status === 'accepted' || status === 'declined') return 'closed'
  if (status === 'expired') return 'expired'
  return daysUntilExpiry(p, now) <= EXPIRING_SOON_DAYS ? 'expiring' : 'live'
}

/** "Expires today" / "Expires in 3 days" / "Expired 12 days ago". */
export function expiryLabel(p: Proposal, now: Date = new Date()): string {
  const d = daysUntilExpiry(p, now)
  if (d === 0) return 'Expires today'
  if (d === 1) return 'Expires tomorrow'
  if (d > 0) return `Expires in ${d} days`
  if (d === -1) return 'Expired yesterday'
  return `Expired ${Math.abs(d)} days ago`
}

// ── List roll-up ──────────────────────────────────────────────────────────────

export interface ProposalKpis {
  /** Live and unanswered: sent, not yet lapsed. */
  pendingValue: number
  pendingCount: number
  /** The subset of those lapsing within EXPIRING_SOON_DAYS. */
  expiringValue: number
  expiringCount: number
  acceptedValue: number
  acceptedCount: number
  declinedCount: number
  expiredCount: number
  expiredValue: number
  /** Accepted + declined + expired — every proposal whose outcome is settled. */
  decidedCount: number
  /**
   * Accepted as a share of decided, or null when nothing has been decided.
   *
   * The page divided by answered proposals only, so a quote that lapsed
   * unanswered counted in neither half. Two accepts, one decline and 97
   * silent expiries reported a 67% win rate against a real 2%; one accept and
   * 24 expiries reported 100%. An expired proposal is a proposal that did not
   * win, so it belongs in the denominator.
   *
   * Null rather than 0 because "nothing sent yet" and "we lose everything"
   * are not the same thing, and the old code rendered both as 0%.
   */
  winRate: number | null
  draftCount: number
}

export function proposalKpis(proposals: Proposal[], now: Date = new Date()): ProposalKpis {
  const k: ProposalKpis = {
    pendingValue: 0, pendingCount: 0, expiringValue: 0, expiringCount: 0,
    acceptedValue: 0, acceptedCount: 0, declinedCount: 0,
    expiredCount: 0, expiredValue: 0, decidedCount: 0, winRate: null, draftCount: 0,
  }

  for (const p of proposals) {
    const total = proposalTotal(p)
    switch (effectiveStatus(p, now)) {
      case 'draft':
        k.draftCount++
        break
      case 'sent':
        k.pendingValue += total
        k.pendingCount++
        if (daysUntilExpiry(p, now) <= EXPIRING_SOON_DAYS) {
          k.expiringValue += total
          k.expiringCount++
        }
        break
      case 'accepted':
        k.acceptedValue += total
        k.acceptedCount++
        break
      case 'declined':
        k.declinedCount++
        break
      case 'expired':
        k.expiredValue += total
        k.expiredCount++
        break
    }
  }

  k.decidedCount = k.acceptedCount + k.declinedCount + k.expiredCount
  k.winRate = k.decidedCount > 0
    ? Math.round((k.acceptedCount / k.decidedCount) * 100)
    : null
  return k
}

// ── Sorting ───────────────────────────────────────────────────────────────────

export type ProposalSortKey =
  | 'urgency' | 'expiryDesc' | 'amountDesc' | 'amountAsc'
  | 'issuedDesc' | 'issuedAsc' | 'customer'

/**
 * The page had no sort control — proposalService sorts newest-created first
 * and that was the only order, so the one question a quote list has to answer
 * ("what lapses next") could only be answered by reading every row's date.
 */
export const PROPOSAL_SORTS: { key: ProposalSortKey; label: string }[] = [
  { key: 'urgency',    label: 'Expiring soonest' },
  { key: 'expiryDesc', label: 'Expiry — latest first' },
  { key: 'amountDesc', label: 'Amount — high to low' },
  { key: 'amountAsc',  label: 'Amount — low to high' },
  { key: 'issuedDesc', label: 'Issued — newest first' },
  { key: 'issuedAsc',  label: 'Issued — oldest first' },
  { key: 'customer',   label: 'Customer A–Z' },
]

export const DEFAULT_PROPOSAL_SORT: ProposalSortKey = 'urgency'

/**
 * Returns a new array; the caller's input is never reordered in place.
 *
 * 'urgency' is not a plain date sort. A straight ascending expiry would put
 * proposals that lapsed two years ago above the one lapsing on Friday, which
 * is the opposite of useful. Live proposals come first by soonest expiry;
 * settled ones (accepted, declined, long expired) fall below, most recent
 * first. Ties break on the proposal number so rows hold their position.
 */
export function sortProposals<T extends Proposal>(
  items: T[],
  key: ProposalSortKey,
  now: Date = new Date(),
): T[] {
  const byNumber = (a: T, b: T) => a.proposalNumber.localeCompare(b.proposalNumber)

  /** 0 for anything still awaiting an answer, 1 for anything settled. */
  const settled = (p: T) => {
    const s = expiryState(p, now)
    return s === 'expiring' || s === 'live' || s === 'draft' ? 0 : 1
  }

  const cmp: Record<ProposalSortKey, (a: T, b: T) => number> = {
    urgency: (a, b) => {
      const g = settled(a) - settled(b)
      if (g !== 0) return g
      const ta = a.expiresDate.getTime(), tb = b.expiresDate.getTime()
      return settled(a) === 0 ? ta - tb : tb - ta
    },
    expiryDesc: (a, b) => b.expiresDate.getTime() - a.expiresDate.getTime(),
    amountDesc: (a, b) => proposalTotal(b)       - proposalTotal(a),
    amountAsc:  (a, b) => proposalTotal(a)       - proposalTotal(b),
    issuedDesc: (a, b) => b.issueDate.getTime()  - a.issueDate.getTime(),
    issuedAsc:  (a, b) => a.issueDate.getTime()  - b.issueDate.getTime(),
    customer:   (a, b) => a.customerName.localeCompare(b.customerName),
  }

  const primary = cmp[key]
  return [...items].sort((a, b) => primary(a, b) || byNumber(a, b))
}

export function generateProposalNumber(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const r = Math.floor(Math.random() * 9000 + 1000)
  return `PROP-${y}${m}-${r}`
}
