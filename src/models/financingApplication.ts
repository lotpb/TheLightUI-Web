export type FinancingSourceType = 'proposal' | 'invoice'

export interface FinancingApplication {
  id: string
  sourceType: FinancingSourceType
  sourceId: string
  customerName: string
  amount: number
  /** Whatever the provider sent. Not a closed set — see financingStatusMeta. */
  status: string
  applyUrl: string
  createdAt: Date | null
  updatedAt: Date | null
}

/**
 * Where an application sits: still in play, won, or lost.
 *
 * The status strings come from the provider's webhook and are passed straight
 * through, so this cannot be a closed union — a provider adding a state would
 * otherwise render as a blank cell. Unknown values group as 'open', which is
 * the safe default: it keeps them visible and out of the won/lost counts
 * rather than silently scoring them.
 */
export type FinancingGroup = 'open' | 'won' | 'lost'

interface StatusMeta {
  label: string
  classes: string
  group: FinancingGroup
}

const KNOWN: Record<string, StatusMeta> = {
  created:   { label: 'Link sent',  classes: 'bg-gray-500/20 text-gray-300',     group: 'open' },
  pending:   { label: 'In review',  classes: 'bg-blue-500/20 text-blue-300',     group: 'open' },
  offered:   { label: 'Offer made', classes: 'bg-indigo-500/20 text-indigo-300', group: 'open' },
  approved:  { label: 'Approved',   classes: 'bg-green-500/20 text-green-300',   group: 'won'  },
  funded:    { label: 'Funded',     classes: 'bg-green-500/20 text-green-300',   group: 'won'  },
  declined:  { label: 'Declined',   classes: 'bg-red-500/20 text-red-300',       group: 'lost' },
  cancelled: { label: 'Cancelled',  classes: 'bg-red-500/20 text-red-300',       group: 'lost' },
  expired:   { label: 'Expired',    classes: 'bg-amber-500/20 text-amber-300',   group: 'lost' },
}

/** Every pill class pair above is one index.css covers for light mode. */
export function financingStatusMeta(status: string): StatusMeta {
  const key = status.trim().toLowerCase()
  return KNOWN[key] ?? {
    // Title-cased rather than raw, so an unmapped "under_review" reads.
    label: status.trim() === ''
      ? 'Unknown'
      : status.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    classes: 'bg-gray-500/20 text-gray-300',
    group: 'open',
  }
}

export interface FinancingSummary {
  total: number
  open: number
  won: number
  lost: number
  /** Money still in play, and money the provider has committed. */
  openValue: number
  wonValue: number
  /** Funded specifically — approved money that has actually landed. */
  fundedValue: number
}

/**
 * The figures this page never had.
 *
 * financingApplications accumulated a document per application, with statuses
 * advanced by the webhook, and no page listed it — the only view was one card
 * on an individual proposal or invoice. So "how many applied, how many were
 * approved, how much got funded" was unanswerable from the app.
 */
export function financingSummary(apps: FinancingApplication[]): FinancingSummary {
  const s: FinancingSummary = {
    total: apps.length, open: 0, won: 0, lost: 0,
    openValue: 0, wonValue: 0, fundedValue: 0,
  }
  for (const a of apps) {
    const { group } = financingStatusMeta(a.status)
    if (group === 'open') { s.open++; s.openValue += a.amount }
    else if (group === 'won') { s.won++; s.wonValue += a.amount }
    else s.lost++
    if (a.status.trim().toLowerCase() === 'funded') s.fundedValue += a.amount
  }
  return s
}

/**
 * Newest first, sorted on the client.
 *
 * The listener filters on companyId only; adding orderBy('createdAt') would
 * need a composite index and would drop any document missing the field —
 * the same trade-off invoiceService documents.
 */
export function sortFinancingApplications(apps: FinancingApplication[]): FinancingApplication[] {
  return [...apps].sort((a, b) => {
    const ta = a.createdAt?.getTime() ?? 0
    const tb = b.createdAt?.getTime() ?? 0
    return tb - ta || a.id.localeCompare(b.id)
  })
}

/** Where the application came from, for the row's link. */
export function financingSourceLink(a: FinancingApplication): string {
  return a.sourceType === 'proposal' ? `/proposals/${a.sourceId}` : `/invoices/${a.sourceId}`
}
