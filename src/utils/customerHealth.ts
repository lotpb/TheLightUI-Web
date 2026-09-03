import type { CustomerItem } from '../models/customer'
import type { Invoice } from '../models/invoice'
import type { ServicePlan } from '../models/servicePlan'

export type HealthLabel = 'Excellent' | 'Good' | 'Fair' | 'At Risk'

export interface HealthFactor {
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
  factors: HealthFactor[]
}

function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function resolveLabel(score: number): Pick<CustomerHealth, 'label' | 'badgeClass' | 'dotClass' | 'barClass'> {
  if (score >= 80) return {
    label: 'Excellent',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    dotClass: 'bg-emerald-400',
    barClass: 'bg-emerald-500',
  }
  // Green, not cyan. The four tiers are one diverging scale, and cyan sits
  // outside the emerald→amber→red ramp — it read as a different family
  // rather than a step down from Excellent. Green keeps the ramp continuous.
  if (score >= 60) return {
    label: 'Good',
    badgeClass: 'bg-green-500/15 text-green-300 border border-green-500/30',
    dotClass: 'bg-green-400',
    barClass: 'bg-green-500',
  }
  if (score >= 40) return {
    label: 'Fair',
    badgeClass: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    dotClass: 'bg-amber-400',
    barClass: 'bg-amber-500',
  }
  return {
    label: 'At Risk',
    badgeClass: 'bg-red-500/15 text-red-300 border border-red-500/30',
    dotClass: 'bg-red-400',
    barClass: 'bg-red-500',
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

  // Recency (35 pts) — days since last record update
  const days = daysSince(customer.lastUpdateDate)
  let recencyPts = 0
  let recencyDetail = ''
  if (days <= 7)       { recencyPts = 35; recencyDetail = 'Updated this week' }
  else if (days <= 30) { recencyPts = 25; recencyDetail = 'Updated this month' }
  else if (days <= 60) { recencyPts = 15; recencyDetail = `Updated ${days}d ago` }
  else if (days <= 90) { recencyPts =  5; recencyDetail = `Updated ${days}d ago` }
  else                 { recencyPts =  0; recencyDetail = `No update in ${days}d` }
  factors.push({ label: 'Recent contact', earned: recencyPts, max: 35, detail: recencyDetail })

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
  factors.push({ label: 'Invoice health', earned: invoicePts, max: 30, detail: invoiceDetail })

  // Active service plan (20 pts)
  const custPlans = plans.filter(p => p.customerId === customer.id)
  const hasActivePlan = custPlans.some(p => p.isActive)
  factors.push({
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
  factors.push({ label: 'Engagement', earned: engPts, max: 15, detail: engDetail })

  const score = factors.reduce((s, f) => s + f.earned, 0)
  return { score, ...resolveLabel(score), factors }
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
