import type { CustomerItem } from './customer'
import { fullName, formatCurrencyPrecise } from './customer'

export type DocTemplateKind = 'proposal' | 'contract' | 'report' | 'letter'

export const KIND_LABELS: Record<DocTemplateKind, string> = {
  proposal: 'Proposal',
  contract: 'Contract',
  report:   'Report',
  letter:   'Letter',
}

/**
 * The 900/40 + 400 pairs, which index.css themes for background *and* text.
 *
 * The previous bg-X-500/15 + text-X-300 badges had text overrides but no
 * background ones, so in light mode the words stayed readable while the pill —
 * a 15% tint with a 25% border over white — all but vanished, leaving four
 * differently-coloured words rather than four badges.
 *
 * Contract moves rose → red and letter teal → sky, because rose and teal have
 * no 900/40 background rule. Both remain distinguishable from each other and
 * from the other two, and the swap buys a badge that survives light mode.
 */
export const KIND_COLORS: Record<DocTemplateKind, string> = {
  proposal: 'bg-indigo-900/40 text-indigo-400 border border-indigo-700/30',
  contract: 'bg-red-900/40 text-red-400 border border-red-700/30',
  report:   'bg-amber-900/40 text-amber-400 border border-amber-700/30',
  letter:   'bg-sky-900/40 text-sky-400 border border-sky-700/30',
}

export interface DocSection {
  heading: string
  body:    string
}

export interface DocTemplate {
  id:        string
  companyId: string
  name:      string
  kind:      DocTemplateKind
  intro:     string
  sections:  DocSection[]
  closing:   string
  createdAt: Date
  updatedAt: Date
}

export const DOC_PLACEHOLDERS = [
  { token: '{{firstName}}',      desc: 'First name' },
  { token: '{{lastName}}',       desc: 'Last name' },
  { token: '{{name}}',           desc: 'Full name' },
  { token: '{{address}}',        desc: 'Street' },
  { token: '{{city}}',           desc: 'City' },
  { token: '{{state}}',          desc: 'State' },
  // buildDocVars has always provided zip; it just wasn't listed, so it worked
  // if you typed it by hand and was otherwise undiscoverable.
  { token: '{{zip}}',            desc: 'ZIP code' },
  { token: '{{phone}}',          desc: 'Phone' },
  { token: '{{email}}',          desc: 'Email' },
  { token: '{{salesman}}',       desc: 'Sales rep' },
  { token: '{{job}}',            desc: 'Job type' },
  { token: '{{product}}',        desc: 'Product' },
  { token: '{{amount}}',         desc: 'Amount' },
  { token: '{{startDate}}',      desc: 'Start date' },
  { token: '{{completionDate}}', desc: 'Completion date' },
  { token: '{{today}}',          desc: "Today's date" },
]

function fmtD(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime()) || d.getTime() < 86_400_000) return ''
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function buildDocVars(c: CustomerItem): Record<string, string> {
  return {
    firstName:      c.first,
    lastName:       c.lastname,
    name:           fullName(c),
    address:        c.street,
    city:           c.city,
    state:          c.state,
    zip:            c.zip,
    phone:          c.phone,
    email:          c.email,
    salesman:       c.salesman,
    job:            c.job,
    product:        c.product,
    // Cents kept. formatCurrency rounds to whole dollars, so a $12,450.75 job
    // printed as "$12,451" inside a proposal or contract the customer signs.
    amount:         c.amount > 0 ? formatCurrencyPrecise(c.amount) : '',
    startDate:      fmtD(c.startDate),
    completionDate: fmtD(c.completionDate),
    today:          fmtD(new Date()),
  }
}

export function interpolateDoc(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}
