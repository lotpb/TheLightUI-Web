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
  /**
   * The Notes & Terms printed on /records/:id/quote.
   *
   * Distinct from `comments`, which is the record's dated activity feed. These
   * are the terms of a document a customer signs, and they lived in
   * localStorage['thelight.quote.notes.<id>'] — so printing the same quote from
   * another machine produced a document with no terms on it, and converting it
   * to an invoice silently dropped them.
   */
  quoteNotes: string
  spouse: string
  email: string
  contractor: string
  photo: string
  lastUpdateDate: Date
  startDate: Date | null
  completionDate: Date | null
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
  paymentTerms: string
  taxId: string
  accountNumber: string
  payType: string
  commissionRate: string
  userRole: string
  lastLogin: string
  employeeStatus: string
  leadStatus: string
  lastContactDate: string
  contactAttempts: number
  companyName: string
  leadSource: string
  paymentStatus: string
  customFields: Record<string, string>
  // Explicit pipeline board position (custom stage id). Empty for records
  // never dragged since the custom-stages feature shipped — effectiveStageId()
  // in models/pipelineStage.ts falls back to the legacy derived stage for those.
  pipelineStage: string
  smsOptOut: boolean
  // Set by the campaignUnsubscribe endpoint when this contact clicks the
  // unsubscribe link in a campaign email. Like smsOptOut, it is deliberately
  // NOT written by customerToFirestore, so an ordinary edit from the customer
  // form can never silently re-subscribe someone who opted out.
  emailOptOut: boolean
  // uid of the users/ doc for the assigned salesman (Lead/Customer only). Empty
  // when unassigned or when `salesman` was set to a legacy free-text name that
  // doesn't correspond to a real team-member account.
  assignedToUid: string
  // uid of whoever created the record. Read-only here: deliberately NOT written
  // by customerToFirestore, so an edit by someone else can never reassign
  // authorship. createCustomer() is the only writer. Empty on records created
  // before this field existed.
  createdByUid: string
  // Token of this customer's portal snapshot (customerPortals/{token}).
  // Read-only here: it is deliberately NOT written by customerToFirestore, so
  // an ordinary customer edit can never clear it. setPortalToken() is the only
  // writer. Empty until a portal link has been generated.
  portalToken: string
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
  quoteNotes: '',
  spouse: '',
  email: '',
  contractor: '',
  photo: '',
  lastUpdateDate: new Date(),
  startDate: null,
  completionDate: null,
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
  paymentTerms: '',
  taxId: '',
  accountNumber: '',
  payType: '',
  commissionRate: '',
  userRole: '',
  lastLogin: '',
  employeeStatus: '',
  leadStatus: '',
  lastContactDate: '',
  contactAttempts: 0,
  companyName: '',
  leadSource: '',
  paymentStatus: '',
  customFields: {},
  pipelineStage: '',
  smsOptOut: false,
  emailOptOut: false,
  assignedToUid: '',
  createdByUid: '',
  portalToken: '',
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

function parseDateOrNull(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate()
  return null
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
    quoteNotes: str(d, 'quoteNotes'),
    spouse: str(d, 'spouse'),
    email: str(d, 'email'),
    contractor: str(d, 'contractor'),
    photo: str(d, 'photo'),
    lastUpdateDate: parseDate(d['lastUpdate']),
    startDate: parseDateOrNull(d['start']),
    completionDate: parseDateOrNull(d['completion']),
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
    paymentTerms: str(d, 'paymentTerms'),
    taxId: str(d, 'taxId'),
    accountNumber: str(d, 'accountNumber'),
    payType: str(d, 'payType'),
    commissionRate: str(d, 'commissionRate'),
    userRole: str(d, 'userRole'),
    lastLogin: str(d, 'lastLogin'),
    employeeStatus: str(d, 'employeeStatus'),
    leadStatus: str(d, 'leadStatus'),
    lastContactDate: str(d, 'lastContactDate'),
    contactAttempts: num(d, 'contactAttempts'),
    companyName: str(d, 'companyName'),
    leadSource: str(d, 'leadSource'),
    paymentStatus: str(d, 'paymentStatus'),
    customFields: parseCustomFields(d['customFields']),
    pipelineStage: str(d, 'pipelineStage'),
    smsOptOut: d['smsOptOut'] === true,
    emailOptOut: d['emailOptOut'] === true,
    assignedToUid: str(d, 'assignedToUid'),
    createdByUid: str(d, 'createdByUid'),
    portalToken: str(d, 'portalToken'),
  }
}

function parseCustomFields(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' || typeof val === 'number') out[k] = String(val)
  }
  return out
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
    quoteNotes: c.quoteNotes,
    spouse: c.spouse,
    photo: c.photo,
    start: c.startDate ? Timestamp.fromDate(c.startDate) : null,
    completion: c.completionDate ? Timestamp.fromDate(c.completionDate) : null,
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
    paymentTerms: c.paymentTerms,
    taxId: c.taxId,
    accountNumber: c.accountNumber,
    payType: c.payType,
    commissionRate: c.commissionRate,
    userRole: c.userRole,
    lastLogin: c.lastLogin,
    employeeStatus: c.employeeStatus,
    leadStatus: c.leadStatus,
    lastContactDate: c.lastContactDate,
    contactAttempts: c.contactAttempts,
    companyName: c.companyName,
    leadSource: c.leadSource,
    paymentStatus: c.paymentStatus,
    customFields: c.customFields ?? {},
    assignedToUid: c.assignedToUid,
  }
  if (userId) data['uid'] = userId
  if (c.category) data['category'] = c.category
  return data
}

export function categoryMatches(stored: string, category: CustomerCategory): boolean {
  return stored.toLowerCase() === category.toLowerCase()
}

export function formatCurrency(cents: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents)
}

/**
 * Money with the cents kept. formatCurrency drops them (maximumFractionDigits:
 * 0), which is right for deal totals and commission sums but wrong for a unit
 * price: /catalog accepts prices at step="0.01" and then displayed 12.50 as
 * "$13", 0.99 as "$1" and 149.95 as "$150" — a price list that disagreed with
 * the invoice it populates. Separate function rather than a change to
 * formatCurrency, which has eighteen call sites that all want whole dollars.
 */
export function formatCurrencyPrecise(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount)
}

export function fullName(c: Pick<CustomerItem, 'first' | 'lastname'> & { category?: string }): string {
  if (c.category?.toLowerCase() === 'vendor') return c.first || ''
  return [c.first, c.lastname].filter(Boolean).join(' ')
}

/**
 * A single-line postal address, for geocoding or display.
 *
 * Returns '' when there's nothing to build from — callers must treat that as
 * "not routable" rather than handing an empty string to a maps API.
 */
export function oneLineAddress(
  c: Pick<CustomerItem, 'street' | 'city' | 'state' | 'zip'>,
): string {
  return [c.street, c.city, c.state, c.zip]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

// The name a record is identified by: a company name outranks the person's name,
// matching how the detail page titles the record.
export function displayName(
  c: Pick<CustomerItem, 'first' | 'lastname' | 'companyName'> & { category?: string },
): string {
  return c.companyName?.trim() || fullName(c)
}

/**
 * Vendor records reuse two fields for different things than Lead/Customer do:
 * `salesman` holds the Callback Yes/No flag, and `callback` holds the Manager's
 * name. Reading them by their raw names is how the /vendors Callback filter
 * ended up comparing a person's name to 'yes', and how the printout got a
 * "Salesman" column full of Yes/No. Go through this accessor instead.
 */
export function vendorFields(c: Pick<CustomerItem, 'salesman' | 'callback'>): {
  callbackFlag: string
  manager: string
} {
  return { callbackFlag: c.salesman, manager: c.callback }
}

/**
 * Firestore keys the record edit form must not write on update.
 *
 * Each is edited elsewhere by a targeted setter — /quote's Notes & Terms,
 * appendCustomerComment, the record page's tag editor, /followups' snooze and
 * complete — and the form has no input for it, so anything it wrote would be
 * the stale value it loaded. followUpDate is the conditional one: the form
 * shows it for vendors, so it's owned there and unowned everywhere else.
 *
 * Create is unaffected — a new record has nothing to overwrite and should get
 * the defaults.
 */
export function formUnownedFields(c: Pick<CustomerItem, 'category'>): string[] {
  const keys = ['quoteNotes', 'comments', 'tags']
  if (c.category.toLowerCase() !== 'vendor') keys.push('followUpDate')
  return keys
}
