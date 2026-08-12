import type { CustomerItem } from '../models/customer'
import { fullName } from '../models/customer'

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Generic browser download ──────────────────────────────────────────────────

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── JSON Export / Import ───────────────────────────────────────────────────────
// Matches CustomerJSONTransfer.swift's CustomerJSONRecord shape exactly.
// Dates serialized as ISO 8601 strings; missing optional fields omitted.

interface CustomerJSONRecord {
  id: string
  first: string
  lastname: string
  phone: string
  email: string
  street: string
  city: string
  state: string
  zip: string
  photo: string
  spouse: string
  birthDate: string
  driverLicense: string
  comments: string
  rate: string
  amount: number
  quantity: number
  isActive: boolean
  salesman?: string
  job?: string
  product?: string
  contractor?: string
  category?: string
  callback?: string
  adNo?: string
  profession?: string
  manager?: string
  creationDate: string
  startDate: string
  completionDate: string
  lastUpdateDate: string
}

function safeISO(d: Date | undefined | null): string {
  if (!d || isNaN(d.getTime())) return ''
  return d.toISOString()
}

function parseISO(s: unknown): Date {
  if (typeof s === 'string' && s) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d
  }
  return new Date()
}

export function exportCustomersJSON(customers: CustomerItem[]) {
  const records: CustomerJSONRecord[] = customers.map(c => ({
    id: c.id,
    first: c.first,
    lastname: c.lastname,
    phone: c.phone,
    email: c.email,
    street: c.street,
    city: c.city,
    state: c.state,
    zip: c.zip,
    photo: c.photo,
    spouse: c.spouse,
    birthDate: c.birthDate,
    driverLicense: c.driverLicense,
    comments: c.comments,
    rate: c.rate,
    amount: c.amount,
    quantity: c.quantity,
    isActive: c.isActive,
    ...(c.salesman    ? { salesman: c.salesman }       : {}),
    ...(c.job         ? { job: c.job }                 : {}),
    ...(c.product     ? { product: c.product }         : {}),
    ...(c.contractor  ? { contractor: c.contractor }   : {}),
    ...(c.category    ? { category: c.category }       : {}),
    ...(c.callback    ? { callback: c.callback }       : {}),
    ...(c.adNo        ? { adNo: c.adNo }               : {}),
    ...(c.profession  ? { profession: c.profession }   : {}),
    ...(c.manager     ? { manager: c.manager }         : {}),
    creationDate:   safeISO(c.creationDate),
    startDate:      safeISO(c.startDate),
    completionDate: safeISO(c.completionDate),
    lastUpdateDate: safeISO(c.lastUpdateDate),
  }))

  const payload = JSON.stringify({ records }, null, 2)
  const date = new Date().toISOString().slice(0, 10)
  downloadFile(payload, `thelight-export-${date}.json`, 'application/json')
}

export async function importCustomersJSON(
  file: File
): Promise<Omit<CustomerItem, 'id'>[]> {
  const text = await file.text()
  const parsed = JSON.parse(text)
  const raw: CustomerJSONRecord[] = Array.isArray(parsed)
    ? parsed
    : parsed.records ?? []

  return raw.map(r => ({
    first:         r.first         ?? '',
    lastname:      r.lastname      ?? '',
    phone:         r.phone         ?? '',
    email:         r.email         ?? '',
    street:        r.street        ?? '',
    city:          r.city          ?? '',
    state:         r.state         ?? '',
    zip:           r.zip           ?? '',
    photo:         r.photo         ?? '',
    spouse:        r.spouse        ?? '',
    birthDate:     r.birthDate     ?? '',
    driverLicense: r.driverLicense ?? '',
    comments:      r.comments      ?? '',
    rate:          r.rate          ?? '',
    amount:        r.amount        ?? 0,
    quantity:      r.quantity      ?? 0,
    isActive:      r.isActive      ?? true,
    salesman:      r.salesman      ?? '',
    job:           r.job           ?? '',
    product:       r.product       ?? '',
    contractor:    r.contractor    ?? '',
    category:      r.category      ?? '',
    callback:      r.callback      ?? '',
    adNo:          r.adNo          ?? '',
    profession:    r.profession    ?? '',
    manager:       r.manager      ?? '',
    creationDate:   parseISO(r.creationDate),
    startDate:      parseISO(r.startDate),
    completionDate: parseISO(r.completionDate),
    lastUpdateDate: parseISO(r.lastUpdateDate),
    followUpDate:   null,
    tags:           [],
  }))
}

// ── Calendar export (.ics) ─────────────────────────────────────────────────────

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
}

function escapeICS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function downloadICS(customer: CustomerItem) {
  const appt = customer.startDate
  if (!appt || isNaN(appt.getTime()) || appt.getTime() === 0) return

  const end = customer.completionDate && !isNaN(customer.completionDate.getTime())
    && customer.completionDate.getTime() > appt.getTime()
    ? customer.completionDate
    : new Date(appt.getTime() + 3600_000) // default 1-hour slot

  const address = [customer.street, customer.city, customer.state, customer.zip]
    .filter(Boolean).join(', ')
  const name = fullName(customer)

  const desc = [
    customer.salesman   ? `Salesman: ${customer.salesman}`   : '',
    customer.job        ? `Job: ${customer.job}`             : '',
    customer.product    ? `Product: ${customer.product}`     : '',
    customer.contractor ? `Contractor: ${customer.contractor}` : '',
    customer.comments   ? `Notes: ${customer.comments}`      : '',
  ].filter(Boolean).join('\\n')

  const uid = `${customer.id}-appt@thelightui`

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TheLight//TheLightUI//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(appt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:Appointment - ${escapeICS(name)}`,
    ...(address ? [`LOCATION:${escapeICS(address)}`] : []),
    ...(desc    ? [`DESCRIPTION:${desc}`]            : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const slug = name.replace(/\s+/g, '_') || 'appointment'
  downloadFile(ics, `${slug}.ics`, 'text/calendar')
}

// ── Contact export (.vcf) ─────────────────────────────────────────────────────

function escapeVCF(s: string): string {
  return s.replace(/\n/g, '\\n').replace(/,/g, '\\,')
}

export function downloadVCF(customer: CustomerItem) {
  const name = fullName(customer)
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCF(name)}`,
    `N:${escapeVCF(customer.lastname)};${escapeVCF(customer.first)};;;`,
  ]

  if (customer.phone)         lines.push(`TEL;TYPE=CELL:${customer.phone}`)
  if (customer.email)         lines.push(`EMAIL;TYPE=INTERNET:${customer.email}`)
  if (customer.street || customer.city) {
    const adr = `;;${customer.street};${customer.city};${customer.state};${customer.zip};`
    lines.push(`ADR;TYPE=HOME:${escapeVCF(adr)}`)
  }
  if (customer.spouse)        lines.push(`X-SPOUSE:${escapeVCF(customer.spouse)}`)
  if (customer.birthDate)     lines.push(`BDAY:${customer.birthDate}`)
  if (customer.comments)      lines.push(`NOTE:${escapeVCF(customer.comments)}`)
  if (customer.driverLicense) lines.push(`X-DRIVER-LICENSE:${escapeVCF(customer.driverLicense)}`)

  lines.push('END:VCARD')

  const slug = name.replace(/\s+/g, '_') || 'contact'
  downloadFile(lines.join('\r\n'), `${slug}.vcf`, 'text/vcard')
}

// ── Print view ────────────────────────────────────────────────────────────────
// Generates and prints an HTML page that matches the design from LeadDetailPrint.swift.

function fmtDate(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime()) || d.getTime() === 0) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function row(label: string, value: string): string {
  if (!value) return ''
  return `<tr><td class="label">${label}</td><td class="value">${esc(value)}</td></tr>`
}

export function printCustomer(customer: CustomerItem, onError?: (msg: string) => void) {
  const name  = fullName(customer)
  const addr  = [customer.street, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${name} — TheLight</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; margin: 40px; color: #1c1c1e; font-size: 14px; }
  .header { border-bottom: 2px solid #007aff; padding-bottom: 14px; margin-bottom: 24px; }
  .name { font-size: 26px; font-weight: 700; color: #007aff; }
  .sub { font-size: 13px; color: #6e6e73; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  tr:nth-child(even) { background-color: #f2f2f7; }
  td { padding: 8px 12px; vertical-align: top; }
  .label { font-weight: 600; color: #3a3a3c; width: 36%; }
  .value { color: #1c1c1e; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6e6e73; margin: 20px 0 6px; }
  .comments-box { background: #f2f2f7; border-radius: 10px; padding: 14px 16px; margin-bottom: 24px; }
  .comments-title { font-weight: 700; font-size: 13px; color: #3a3a3c; margin-bottom: 6px; }
  .comments-body { font-size: 14px; color: #1c1c1e; line-height: 1.6; white-space: pre-wrap; }
  .footer { margin-top: 32px; font-size: 11px; color: #aeaeb2; text-align: right; border-top: 1px solid #e5e5ea; padding-top: 10px; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<div class="header">
  <div class="name">${esc(name) || '—'}</div>
  ${addr ? `<div class="sub">${esc(addr)}</div>` : ''}
  ${customer.category ? `<div class="sub">${esc(customer.category)}</div>` : ''}
</div>

<p class="section-title">Contact</p>
<table>
  ${row('Phone', customer.phone)}
  ${row('Email', customer.email)}
  ${row('Spouse', customer.spouse)}
  ${row('Birth Date', customer.birthDate)}
  ${row('Driver License', customer.driverLicense)}
</table>

<p class="section-title">Job Info</p>
<table>
  ${row('Salesman', customer.salesman)}
  ${row('Job', customer.job)}
  ${row('Product', customer.product)}
  ${row('Contractor', customer.contractor)}
  ${row('Quantity', customer.quantity > 0 ? String(customer.quantity) : '')}
  ${row('Rate', customer.rate)}
  ${row('Amount', customer.amount > 0 ? `$${customer.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '')}
  ${row('Called', customer.callback)}
  ${row('Ad Source', customer.adNo)}
</table>

<p class="section-title">Schedule</p>
<table>
  ${row('Created',     fmtDate(customer.creationDate))}
  ${row('Appointment', fmtDate(customer.startDate))}
  ${row('Completion',  fmtDate(customer.completionDate))}
  ${row('Last Update', fmtDate(customer.lastUpdateDate))}
</table>

${customer.comments ? `
<div class="comments-box">
  <div class="comments-title">Comments</div>
  <div class="comments-body">${esc(customer.comments)}</div>
</div>` : ''}

<div class="footer">Printed from TheLight &bull; ${today}</div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=800,height=900')
  if (!win) { onError?.('Please allow popups to print.'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 300)
}
