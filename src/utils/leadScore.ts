import type { CustomerItem } from '../models/customer'

export type ScoreLabel = 'Hot' | 'Warm' | 'Cool' | 'Cold'

export interface ScoreFactor {
  label: string
  earned: number
  max: number
}

export interface LeadScore {
  score: number
  label: ScoreLabel
  badgeClass: string
  dotClass: string
  factors: ScoreFactor[]
}

function factor(label: string, max: number, condition: boolean): ScoreFactor {
  return { label, earned: condition ? max : 0, max }
}

export function scoreLead(c: CustomerItem): LeadScore {
  const factors: ScoreFactor[] = [
    factor('Has phone number',       15, !!c.phone.trim()),
    factor('Has email address',      10, !!c.email.trim()),
    factor('Has physical address',    5, !!c.street.trim()),
    factor('Has been called',        15, c.callback.toLowerCase() === 'yes'),
    factor('Follow-up date set',     10, !!c.followUpDate),
    factor('Appointment in future',  20, !!(c.startDate && c.startDate.getTime() > Date.now())),
    factor('Job or product known',   10, !!(c.job.trim() || c.product.trim())),
    factor('Salesman assigned',       5, !!c.salesman.trim()),
    factor('Lead source known',       5, !!c.leadSource.trim()),
    factor('Has deal amount',         5, c.amount > 0),
  ]

  const score = factors.reduce((s, f) => s + f.earned, 0)

  let label: ScoreLabel
  let badgeClass: string
  let dotClass: string

  if (score >= 70) {
    label = 'Hot'
    badgeClass = 'bg-red-500/15 text-red-300 border border-red-500/30'
    dotClass = 'bg-red-400'
  } else if (score >= 45) {
    label = 'Warm'
    badgeClass = 'bg-orange-500/15 text-orange-300 border border-orange-500/30'
    dotClass = 'bg-orange-400'
  } else if (score >= 20) {
    label = 'Cool'
    badgeClass = 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
    dotClass = 'bg-blue-400'
  } else {
    label = 'Cold'
    badgeClass = 'bg-gray-700/50 text-gray-400 border border-gray-600'
    dotClass = 'bg-gray-500'
  }

  return { score, label, badgeClass, dotClass, factors }
}
