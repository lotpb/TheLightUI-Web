import type { CustomerItem } from '../models/customer'
import type { Invoice } from '../models/invoice'
import type { ServicePlan } from '../models/servicePlan'

export type HealthLabel = 'Excellent' | 'Good' | 'Fair' | 'At Risk'

/** The score every band and factor total is expressed out of. */
export const HEALTH_MAX = 100

/**
 * Stable identifiers for the four factors.
 *
 * The recency factor's *label* now depends on what it was able to measure, so
 * nothing should look a factor up by display text.
 */
export type HealthFactorKey = 'recency' | 'invoices' | 'plan' | 'engagement'

export interface HealthFactor {
  key: HealthFactorKey
  label: string
  earned: number
  max: number
  detail: string
}

export interface CustomerHealth {
  score: number
  label: HealthLabel
  badgeClass: string
  dotClass: string
  barClass: string
  numberClass: string
  factors: HealthFactor[]
}

function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

/** A `yyyy-mm-dd` field as a Date, or null when unset or unparseable. */
function parseISODay(iso: string): Date | null {
  if (!iso?.trim()) return null
  const d = new Date(`${iso.trim()}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export interface HealthBand {
  label: HealthLabel
  /** Inclusive lower bound. Descending order, so the first match wins. */
  min: number
  badgeClass: string
  dotClass: string
  barClass: string
  /**
   * For a large bare number, like the summary tiles on /customer-health.
   *
   * That page kept its own colorMap and used text-cyan-400 for Good — the
   * exact colour the note below says this scale moved away from — so its
   * tiles and its row badges disagreed about what Good looks like. cyan-400
   * also has no light-mode override, so it sat at 1.81:1 on a white card.
   */
  numberClass: string
}

/**
 * The four bands, highest first — one source for resolveLabel(), for the Health
 * quick filters on /customers, and for the legend the list renders above its
 * rows.
 *
 * The thresholds used to exist only inside resolveLabel's if-chain, so a chip
 * could read "Good 72" with nothing on the page saying Good spans 60–79. The
 * chip's per-factor breakdown is a `title` tooltip, which doesn't exist on
 * touch, so on a tablet the bands had no on-screen explanation at all. A legend
 * keyed off this array can't drift from the chips it explains.
 *
 * Green, not cyan, for the second tier. The four are one diverging scale and
 * cyan sits outside the emerald→amber→red ramp — it read as a different family
 * rather than a step down from Excellent.
 */
export const HEALTH_BANDS: HealthBand[] = [
  {
    label: 'Excellent',
    min: 80,
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    dotClass: 'bg-emerald-400',
    barClass: 'bg-emerald-500',
    numberClass: 'text-emerald-400',
  },
  {
    label: 'Good',
    min: 60,
    badgeClass: 'bg-green-500/15 text-green-300 border border-green-500/30',
    dotClass: 'bg-green-400',
    barClass: 'bg-green-500',
    numberClass: 'text-green-400',
  },
  {
    label: 'Fair',
    min: 40,
    badgeClass: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    dotClass: 'bg-amber-400',
    barClass: 'bg-amber-500',
    numberClass: 'text-amber-400',
  },
  {
    label: 'At Risk',
    min: 0,
    badgeClass: 'bg-red-500/15 text-red-300 border border-red-500/30',
    dotClass: 'bg-red-400',
    barClass: 'bg-red-500',
    numberClass: 'text-red-400',
  },
]

/** The inclusive range a band covers, for display: "80+", "60–79", "0–39". */
export function healthBandRange(index: number): string {
  const band = HEALTH_BANDS[index]
  if (index === 0) return `${band.min}+`
  return `${band.min}–${HEALTH_BANDS[index - 1].min - 1}`
}

export function healthBandFor(score: number): HealthBand {
  return HEALTH_BANDS.find(b => score >= b.min) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1]
}

function resolveLabel(score: number): Omit<CustomerHealth, 'score' | 'factors'> {
  const band = healthBandFor(score)
  return {
    label: band.label,
    badgeClass: band.badgeClass,
    dotClass: band.dotClass,
    barClass: band.barClass,
    numberClass: band.numberClass,
  }
}

/** Plain-text breakdown for a title tooltip. Only meaningful for the full
 *  score — calculateHealthScoreLight returns `factors: []`. Mirrors
 *  scoreBreakdown() in utils/leadScore, so both chips explain themselves. */
export function healthBreakdown(h: CustomerHealth): string {
  const lines = h.factors.map(f => {
    const mark = f.earned === f.max ? '✓' : f.earned > 0 ? '~' : '·'
    return `${mark} ${f.label} — ${f.earned}/${f.max} · ${f.detail}`
  })
  return [`Health ${h.score}/100 · ${h.label}`, '', ...lines].join('\n')
}

// Full score — needs invoices + plans. Use on the detail page and the list.
export function calculateHealthScore(
  customer: CustomerItem,
  invoices: Invoice[],
  plans: ServicePlan[],
): CustomerHealth {
  const factors: HealthFactor[] = []

  /**
   * Recency (35 pts) — the largest single factor.
   *
   * It measured `lastUpdateDate`, which customerToFirestore stamps on *every*
   * save, and then called itself "Recent contact": correcting a typo in a zip
   * code awarded the full 35 points and the line "Updated this week". The
   * record carries a `lastContactDate` the customer form lets you set and the
   * detail page renders as "Last Contact" — the field actually named for this.
   *
   * That field is optional, so scoring it alone would drop every customer who
   * doesn't use it by 35 points and make the whole book At Risk. It is used
   * when present and the record's own activity stands in otherwise, with the
   * label and the detail saying which of the two was measured.
   */
  const contactDate = parseISODay(customer.lastContactDate)
  const basisDate   = contactDate ?? customer.lastUpdateDate
  const measured: 'contact' | 'record' = contactDate ? 'contact' : 'record'
  const days = daysSince(basisDate)

  const recencyPts =
    days <= 7  ? 35 :
    days <= 30 ? 25 :
    days <= 60 ? 15 :
    days <= 90 ?  5 : 0

  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
  const recencyDetail = measured === 'contact'
    ? (days <= 90 ? `Contacted ${ago}` : `No contact in ${days}d`)
    : (days <= 90
        ? `No contact date on file — record edited ${ago}`
        : `No contact date on file — record untouched for ${days}d`)

  factors.push({
    key: 'recency',
    label: measured === 'contact' ? 'Recent contact' : 'Record activity',
    earned: recencyPts,
    max: 35,
    detail: recencyDetail,
  })

  // Invoice health (30 pts)
  const custInvoices = invoices.filter(inv => inv.customerId === customer.id)
  const now = new Date()
  const hasOverdue = custInvoices.some(inv => inv.status !== 'paid' && inv.dueDate < now)
  const hasPaid    = custInvoices.some(inv => inv.status === 'paid')
  const invoicePts = hasOverdue ? 0 : hasPaid ? 30 : custInvoices.length > 0 ? 20 : 15
  const invoiceDetail = hasOverdue
    ? 'Has overdue invoice(s)'
    : hasPaid ? 'Paid · no overdue'
    : custInvoices.length > 0 ? 'Invoices current'
    : 'No invoices on file'
  factors.push({ key: 'invoices', label: 'Invoice health', earned: invoicePts, max: 30, detail: invoiceDetail })

  // Active service plan (20 pts)
  const custPlans = plans.filter(p => p.customerId === customer.id)
  const hasActivePlan = custPlans.some(p => p.isActive)
  factors.push({
    key: 'plan',
    label: 'Service plan',
    earned: hasActivePlan ? 20 : 0,
    max: 20,
    detail: hasActivePlan ? 'Active plan on file' : 'No active service plan',
  })

  // Engagement (15 pts)
  const hasNotes    = !!customer.comments?.trim()
  const hasFollowUp = !!customer.followUpDate
  const hasAmount   = customer.amount > 0
  const engPts = (hasNotes ? 5 : 0) + (hasFollowUp ? 5 : 0) + (hasAmount ? 5 : 0)
  const engDetail = [
    hasNotes    && 'notes',
    hasFollowUp && 'follow-up set',
    hasAmount   && 'deal amount',
  ].filter(Boolean).join(', ') || 'None'
  factors.push({ key: 'engagement', label: 'Engagement', earned: engPts, max: 15, detail: engDetail })

  const score = factors.reduce((s, f) => s + f.earned, 0)
  return { score, ...resolveLabel(score), factors }
}

// ── List aggregation, sorting and search ──────────────────────────────────────
//
// /customer-health computed its tile counts and average from every active
// customer while the list beneath applied both a band filter and a rep filter,
// so picking a rep left "At Risk 12" sitting above three rows. These take the
// list they describe, so the summary can't disagree with what's on screen.

export interface ScoredCustomer {
  customer: CustomerItem
  health: CustomerHealth
}

export interface HealthSummary {
  counts: Record<HealthLabel, number>
  /** Rounded mean, or null for an empty list rather than a misleading 0. */
  avg: number | null
  total: number
}

export function healthSummary(scored: ScoredCustomer[]): HealthSummary {
  const counts: Record<HealthLabel, number> = { Excellent: 0, Good: 0, Fair: 0, 'At Risk': 0 }
  for (const s of scored) counts[s.health.label]++
  return {
    counts,
    avg: scored.length === 0
      ? null
      : Math.round(scored.reduce((sum, s) => sum + s.health.score, 0) / scored.length),
    total: scored.length,
  }
}

export type HealthSort = 'worst' | 'best' | 'name' | 'recent'

export const HEALTH_SORTS: { key: HealthSort; label: string }[] = [
  { key: 'worst',  label: 'Worst first' },
  { key: 'best',   label: 'Best first' },
  { key: 'name',   label: 'Name A–Z' },
  { key: 'recent', label: 'Least recent' },
]

export function sortScored(scored: ScoredCustomer[], sort: HealthSort): ScoredCustomer[] {
  const name = (s: ScoredCustomer) => `${s.customer.first} ${s.customer.lastname}`.trim().toLowerCase()
  const byWorst = (a: ScoredCustomer, b: ScoredCustomer) => a.health.score - b.health.score
  const cmp: Record<HealthSort, (a: ScoredCustomer, b: ScoredCustomer) => number> = {
    worst:  byWorst,
    best:   (a, b) => b.health.score - a.health.score,
    name:   (a, b) => name(a).localeCompare(name(b)),
    recent: (a, b) => a.customer.lastUpdateDate.getTime() - b.customer.lastUpdateDate.getTime(),
  }
  const primary = cmp[sort]
  return [...scored].sort((a, b) => primary(a, b) || byWorst(a, b) || name(a).localeCompare(name(b)))
}

export function searchScored(scored: ScoredCustomer[], query: string): ScoredCustomer[] {
  const q = query.trim().toLowerCase()
  if (!q) return scored
  const digits = q.replace(/\D/g, '')
  return scored.filter(s => {
    const c = s.customer
    return (
      `${c.first} ${c.lastname}`.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q) ||
      // So "555 123" finds a phone stored as (555) 123-4567.
      (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))
    )
  })
}

/**
 * The factors dragging a score down, worst shortfall first.
 *
 * `factors` was computed for every row on /customer-health and thrown away, so
 * a triage page said "At Risk · 35" and never said why — the one actionable
 * part of the score never reached the screen.
 */
export function healthShortfalls(h: CustomerHealth): HealthFactor[] {
  return h.factors
    .filter(f => f.earned < f.max)
    .sort((a, b) => (b.max - b.earned) - (a.max - a.earned))
}

// REMOVED: calculateHealthScoreLight.
//
// It scored recency (35) + engagement (15) out of 50 and scaled that to 100,
// then ran the result through the same resolveLabel() thresholds as the full
// score — which also weighs invoice health (30) and service plans (20). The two
// therefore disagreed on the same customer, while rendering identical labels,
// colours and chip shapes:
//
//   updated this week, overdue invoices, no plan  ->  light 70 "Good"
//                                                     full  35 "At Risk"
//
// /customers showed the light label; /records/:id and /health showed the full
// one. Because invoices were excluded, the light score's "At Risk" could only
// ever mean "stale record", never a payment problem — so the Health quick
// filter surfaced the wrong customers.
//
// The list now uses calculateHealthScore with shared invoice and service-plan
// subscriptions. Don't reintroduce a partial variant that reuses these labels:
// a weaker score needs its own vocabulary, or none.
