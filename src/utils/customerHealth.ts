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
  if (score >= 60) return {
    label: 'Good',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30',
    dotClass: 'bg-cyan-400',
    barClass: 'bg-cyan-500',
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

// Full score — needs invoices + plans. Use on detail page.
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

// Light score — customer fields only. Use on list page.
// Uses recency (35) + engagement (15) = max 50 pts, scaled to 100.
export function calculateHealthScoreLight(customer: CustomerItem): CustomerHealth {
  const days = daysSince(customer.lastUpdateDate)
  let recencyPts = 0
  if (days <= 7)       recencyPts = 35
  else if (days <= 30) recencyPts = 25
  else if (days <= 60) recencyPts = 15
  else if (days <= 90) recencyPts =  5

  const hasNotes    = !!customer.comments?.trim()
  const hasFollowUp = !!customer.followUpDate
  const hasAmount   = customer.amount > 0
  const engPts = (hasNotes ? 5 : 0) + (hasFollowUp ? 5 : 0) + (hasAmount ? 5 : 0)

  // Scale the 0-50 raw pts to 0-100
  const raw = recencyPts + engPts
  const score = Math.round((raw / 50) * 100)

  return {
    score,
    ...resolveLabel(score),
    factors: [],
  }
}
