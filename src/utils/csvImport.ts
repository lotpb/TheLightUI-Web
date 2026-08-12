import { emptyCustomer, type CustomerItem } from '../models/customer'

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    const row: string[] = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (c === ',' && !inQuotes) {
        row.push(field.trim()); field = ''
      } else {
        field += c
      }
    }
    row.push(field.trim())
    rows.push(row)
  }
  return rows
}

// ── Column detection ──────────────────────────────────────────────────────────

// Supported CRM field keys and their recognized column header aliases
const FIELD_ALIASES: Record<string, string[]> = {
  first:      ['first', 'first name', 'firstname', 'given name', 'name'],
  lastname:   ['last', 'last name', 'lastname', 'surname', 'family name'],
  phone:      ['phone', 'phone number', 'cell', 'mobile', 'telephone', 'tel'],
  email:      ['email', 'email address', 'e-mail', 'e mail'],
  street:     ['street', 'address', 'street address', 'addr'],
  city:       ['city', 'town'],
  state:      ['state', 'province', 'st'],
  zip:        ['zip', 'zipcode', 'postal', 'postal code', 'zip code'],
  category:   ['category', 'type', 'record type'],
  salesman:   ['salesman', 'agent', 'rep', 'sales rep', 'assigned to', 'assigned'],
  job:        ['job', 'job type', 'service'],
  product:    ['product', 'product name', 'item'],
  amount:     ['amount', 'price', 'total', 'value', 'deal value', 'revenue', 'sale'],
  adNo:       ['adno', 'ad no', 'ad number', 'source', 'lead source', 'referral', 'ad'],
  comments:   ['comments', 'notes', 'note', 'comment'],
  callback:   ['callback', 'called', 'contacted', 'cb'],
  contractor: ['contractor', 'sub', 'subcontractor'],
  spouse:     ['spouse', 'partner', 'co-applicant', 'coapplicant'],
  rate:       ['rate', 'rating', 'grade'],
  startDate:  ['start date', 'startdate', 'appointment', 'appt date', 'appt'],
  completionDate: ['completion date', 'complete date', 'end date', 'completiondate'],
}

export type ColumnMap = Partial<Record<keyof typeof FIELD_ALIASES, number>>

export function detectColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase().trim()
      if (aliases.includes(h)) {
        map[field as keyof ColumnMap] = i
        break
      }
    }
  }
  return map
}

export const FIELD_LABELS: Record<string, string> = {
  first: 'First Name', lastname: 'Last Name', phone: 'Phone', email: 'Email',
  street: 'Street', city: 'City', state: 'State', zip: 'ZIP',
  category: 'Category', salesman: 'Salesman', job: 'Job', product: 'Product',
  amount: 'Amount', adNo: 'Ad Source', comments: 'Comments', callback: 'Called',
  contractor: 'Contractor', spouse: 'Spouse', rate: 'Rating',
  startDate: 'Start/Appt Date', completionDate: 'Completion Date',
}

// ── Row → CustomerItem ────────────────────────────────────────────────────────

function col(row: string[], map: ColumnMap, field: keyof ColumnMap): string {
  const idx = map[field]
  return idx !== undefined ? (row[idx] ?? '').trim() : ''
}

function safeAmount(s: string): number {
  const n = parseFloat(s.replace(/[$,\s]/g, ''))
  return isNaN(n) ? 0 : n
}

function safeDate(s: string): Date {
  if (!s) return new Date()
  const d = new Date(s)
  return isNaN(d.getTime()) ? new Date() : d
}

export function csvRowToCustomer(
  row: string[],
  map: ColumnMap,
  defaultCategory: string,
): Omit<CustomerItem, 'id'> {
  const base = emptyCustomer()
  const now  = new Date()
  const rawCategory = col(row, map, 'category') || defaultCategory
  const category = rawCategory.charAt(0).toUpperCase() + rawCategory.slice(1).toLowerCase() || 'Lead'

  return {
    ...base,
    first:          col(row, map, 'first'),
    lastname:       col(row, map, 'lastname'),
    phone:          col(row, map, 'phone'),
    email:          col(row, map, 'email'),
    street:         col(row, map, 'street'),
    city:           col(row, map, 'city'),
    state:          col(row, map, 'state'),
    zip:            col(row, map, 'zip'),
    category,
    salesman:       col(row, map, 'salesman'),
    job:            col(row, map, 'job'),
    product:        col(row, map, 'product'),
    amount:         safeAmount(col(row, map, 'amount')),
    adNo:           col(row, map, 'adNo'),
    comments:       col(row, map, 'comments'),
    callback:       col(row, map, 'callback'),
    contractor:     col(row, map, 'contractor'),
    spouse:         col(row, map, 'spouse'),
    rate:           col(row, map, 'rate'),
    startDate:      col(row, map, 'startDate') ? safeDate(col(row, map, 'startDate')) : now,
    completionDate: col(row, map, 'completionDate') ? safeDate(col(row, map, 'completionDate')) : now,
    isActive:       true,
    creationDate:   now,
    lastUpdateDate: now,
    followUpDate:   null,
    tags:           [],
  }
}

// ── Template generator ────────────────────────────────────────────────────────

export function downloadCSVTemplate() {
  const headers = [
    'First Name', 'Last Name', 'Phone', 'Email',
    'Street', 'City', 'State', 'ZIP',
    'Category', 'Salesman', 'Job', 'Product', 'Amount', 'Ad Source',
    'Comments', 'Called', 'Start/Appt Date',
  ]
  const example = [
    'John', 'Smith', '555-123-4567', 'john@example.com',
    '123 Main St', 'Miami', 'FL', '33101',
    'Lead', 'Jane Doe', 'Windows', 'Double Hung', '5000', 'Google',
    'Called twice, interested', 'Yes', '2026-09-01',
  ]
  const csv  = [headers, example].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'crm-import-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}
