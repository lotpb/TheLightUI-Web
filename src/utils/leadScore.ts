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

/** Plain-text breakdown of how a score was earned, for a title tooltip.
 *  `factors` is built on every scoreLead() call but was never surfaced, so
 *  there was no way to tell why a lead scored what it did — or what would
 *  move it. */
export function scoreBreakdown(s: LeadScore): string {
  const lines = s.factors.map(f => `${f.earned > 0 ? '✓' : '·'} ${f.label} — ${f.earned}/${f.max}`)
  return [`Lead score ${s.score}/100 · ${s.label}`, '', ...lines].join('\n')
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
  const band = SCORE_BANDS.find(b => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1]

  return {
    score,
    label: band.label,
    badgeClass: band.badgeClass,
    dotClass: band.dotClass,
    factors,
  }
}

export interface ScoreBand {
  label: ScoreLabel
  /** Inclusive lower bound. Descending order, so the first match wins. */
  min: number
  badgeClass: string
  dotClass: string
}

/**
 * The four bands, highest first — one source for scoreLead(), for the Hot Leads
 * quick filter, and for the legend /leads renders above its rows.
 *
 * The thresholds used to live only in an if-chain here, so a chip reading
 * "Warm 52" had nothing on the page saying Warm spans 45–69, and scoreBreakdown
 * is delivered through a `title` tooltip that doesn't exist on touch. Mirrors
 * HEALTH_BANDS in utils/customerHealth, which the same list component keys its
 * customer legend from.
 *
 * Hot is emerald, not red, and Warm is green, not orange.
 *
 * Red already means "bad" everywhere else in this app — At Risk on the customer
 * health scale, Lost on the lead status pill — and both of those render in the
 * same row as this chip. A red "Hot 85" chip sitting beside a red "Lost" pill
 * had the two reds meaning opposite things on one line. Temperature is the
 * label's job; the hue now carries quality on the same emerald→green ramp the
 * health chip uses, which frees red to mean only one thing. Cool keeps blue as
 * a neutral low-score readout and Cold keeps grey.
 */
export const SCORE_BANDS: ScoreBand[] = [
  {
    label: 'Hot',
    min: 70,
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    dotClass: 'bg-emerald-400',
  },
  {
    label: 'Warm',
    min: 45,
    badgeClass: 'bg-green-500/15 text-green-300 border border-green-500/30',
    dotClass: 'bg-green-400',
  },
  {
    label: 'Cool',
    min: 20,
    badgeClass: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
    dotClass: 'bg-blue-400',
  },
  {
    label: 'Cold',
    min: 0,
    badgeClass: 'bg-gray-700/50 text-gray-400 border border-gray-600',
    dotClass: 'bg-gray-500',
  },
]

/** The inclusive range a band covers, for display: "70+", "45–69", "0–19". */
export function scoreBandRange(index: number): string {
  const band = SCORE_BANDS[index]
  if (index === 0) return `${band.min}+`
  return `${band.min}–${SCORE_BANDS[index - 1].min - 1}`
}
