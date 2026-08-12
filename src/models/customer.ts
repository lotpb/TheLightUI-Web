import { Timestamp, type DocumentData, type DocumentSnapshot, type QueryDocumentSnapshot } from 'firebase/firestore'

export type CustomerCategory = 'Lead' | 'Customer' | 'Vendor' | 'Employee'

export const CATEGORIES: CustomerCategory[] = ['Lead', 'Customer', 'Vendor', 'Employee']

export const CATEGORY_LABELS: Record<CustomerCategory, string> = {
  Lead: 'Leads',
  Customer: 'Customers',
  Vendor: 'Vendors',
  Employee: 'Employees',
}

export interface CustomerItem {
  id: string
  isActive: boolean
  first: string
  lastname: string
  street: string
  city: string
  state: string
  zip: string
  amount: number
  creationDate: Date
  rate: string
  phone: string
  comments: string
  spouse: string
  email: string
  contractor: string
  photo: string
  lastUpdateDate: Date
  startDate: Date
  completionDate: Date
  quantity: number
  salesman: string
  job: string
  product: string
  category: string
  callback: string
  adNo: string
  birthDate: string
  driverLicense: string
  profession: string
  manager: string
  followUpDate: Date | null
  tags: string[]
}

export const emptyCustomer = (): CustomerItem => ({
  id: '',
  isActive: true,
  first: '',
  lastname: '',
  street: '',
  city: '',
  state: '',
  zip: '',
  amount: 0,
  creationDate: new Date(),
  rate: '',
  phone: '',
  comments: '',
  spouse: '',
  email: '',
  contractor: '',
  photo: '',
  lastUpdateDate: new Date(),
  startDate: new Date(),
  completionDate: new Date(),
  quantity: 0,
  salesman: '',
  job: '',
  product: '',
  category: '',
  callback: '',
  adNo: '',
  birthDate: '',
  driverLicense: '',
  profession: '',
  manager: '',
  followUpDate: null,
  tags: [],
})

// Mirrors the defensive parsing in CustomerFirestore.swift
function parseActive(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v === '1'
  if (typeof v === 'number') return v === 1
  return false
}

function parseAdNo(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
}

function parseDate(v: unknown): Date {
  if (v instanceof Timestamp) return v.toDate()
  return new Date()
}

function str(data: DocumentData, field: string): string {
  return typeof data[field] === 'string' ? data[field] : ''
}

function num(data: DocumentData, field: string): number {
  const v = data[field]
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = Number(v); return isNaN(n) ? 0 : n }
  return 0
}

const CATEGORY_MAP: Record<string, CustomerCategory> = {
  lead: 'Lead', customer: 'Customer', vendor: 'Vendor', employee: 'Employee',
}

function normalizeCategory(raw: string): string {
  return CATEGORY_MAP[raw.toLowerCase()] ?? raw
}

export function customerFromDoc(doc: QueryDocumentSnapshot | DocumentSnapshot): CustomerItem {
  const d = doc.data()!
  // Firestore field "street" falls back to legacy "address" field
  const street = str(d, 'street') || str(d, 'address')
  return {
    id: doc.id,
    isActive: parseActive(d['active']),
    first: str(d, 'first'),
    lastname: str(d, 'lastname'),
    street,
    city: str(d, 'city'),
    state: str(d, 'state'),
    zip: str(d, 'zip'),
    amount: num(d, 'amount'),
    creationDate: parseDate(d['creationDate']),
    rate: str(d, 'rate'),
    phone: str(d, 'phone'),
    comments: str(d, 'comments'),
    spouse: str(d, 'spouse'),
    email: str(d, 'email'),
    contractor: str(d, 'contractor'),
    photo: str(d, 'photo'),
    lastUpdateDate: parseDate(d['lastUpdate']),
    startDate: parseDate(d['start']),
    completionDate: parseDate(d['completion']),
    quantity: num(d, 'quan'),        // Firestore field is "quan", not "quantity"
    salesman: str(d, 'salesman'),
    job: str(d, 'job'),
    product: str(d, 'product'),
    category: normalizeCategory(str(d, 'category')),
    callback: str(d, 'callback'),
    adNo: parseAdNo(d['adNo']),
    birthDate: str(d, 'birthDate'),
    driverLicense: str(d, 'driverLicense'),
    profession: str(d, 'profession'),
    manager: str(d, 'manager'),
    followUpDate: d['followUpDate'] ? parseDate(d['followUpDate']) : null,
    tags: Array.isArray(d['tags']) ? (d['tags'] as unknown[]).filter((t): t is string => typeof t === 'string') : [],
  }
}

export function customerToFirestore(c: CustomerItem, userId?: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    active: c.isActive ? '1' : '0',
    first: c.first,
    lastname: c.lastname,
    contractor: c.contractor,
    salesman: c.salesman,
    job: c.job,
    product: c.product,
    street: c.street,
    city: c.city,
    state: c.state,
    zip: c.zip,
    phone: c.phone,
    amount: c.amount,
    email: c.email,
    rate: c.rate,
    quan: c.quantity,
    comments: c.comments,
    spouse: c.spouse,
    photo: c.photo,
    start: Timestamp.fromDate(c.startDate),
    completion: Timestamp.fromDate(c.completionDate),
    lastUpdate: Timestamp.fromDate(new Date()),
    creationDate: Timestamp.fromDate(c.creationDate),
    callback: c.callback,
    adNo: c.adNo,
    birthDate: c.birthDate,
    driverLicense: c.driverLicense,
    profession: c.profession,
    manager: c.manager,
    followUpDate: c.followUpDate ? Timestamp.fromDate(c.followUpDate) : null,
    tags: c.tags ?? [],
  }
  if (userId) data['uid'] = userId
  if (c.category) data['category'] = c.category
  return data
}

export function categoryMatches(stored: string, category: CustomerCategory): boolean {
  return stored.toLowerCase() === category.toLowerCase()
}

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents)
}

export function fullName(c: Pick<CustomerItem, 'first' | 'lastname'>): string {
  return [c.first, c.lastname].filter(Boolean).join(' ')
}
