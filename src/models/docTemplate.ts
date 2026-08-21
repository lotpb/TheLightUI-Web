import type { CustomerItem } from './customer'
import { fullName, formatCurrency } from './customer'

export type DocTemplateKind = 'proposal' | 'contract' | 'report' | 'letter'

export const KIND_LABELS: Record<DocTemplateKind, string> = {
  proposal: 'Proposal',
  contract: 'Contract',
  report:   'Report',
  letter:   'Letter',
}

export const KIND_COLORS: Record<DocTemplateKind, string> = {
  proposal: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/25',
  contract: 'bg-rose-500/15 text-rose-300 border border-rose-500/25',
  report:   'bg-amber-500/15 text-amber-300 border border-amber-500/25',
  letter:   'bg-teal-500/15 text-teal-300 border border-teal-500/25',
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
    amount:         c.amount > 0 ? formatCurrency(c.amount) : '',
    startDate:      fmtD(c.startDate),
    completionDate: fmtD(c.completionDate),
    today:          fmtD(new Date()),
  }
}

export function interpolateDoc(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}
