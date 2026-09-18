export type AuditEntityType = 'customer' | 'invoice' | 'proposal'
export type AuditAction = 'created' | 'updated' | 'deleted'

export interface AuditChange {
  field: string
  from: string
  to: string
}

export interface AuditLogEntry {
  id: string
  companyId: string
  entityType: AuditEntityType
  entityId: string
  entityLabel: string
  action: AuditAction
  changedBy: string
  changes: AuditChange[]
  createdAt: Date
}

export const ACTION_LABELS: Record<AuditAction, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
}

/**
 * Badge classes per action. All three combinations have explicit light-mode
 * rules in index.css keyed on this exact pairing — auditLog.test.ts checks
 * they still do.
 */
export const ACTION_COLORS: Record<AuditAction, string> = {
  created: 'bg-green-500/20 text-green-300',
  updated: 'bg-blue-500/20 text-blue-300',
  deleted: 'bg-red-500/20 text-red-300',
}

// ── Entity types ──────────────────────────────────────────────────────────────

export const AUDIT_ENTITY_TYPES: AuditEntityType[] = ['customer', 'invoice', 'proposal']

export type AuditFilter = 'all' | AuditEntityType

export const AUDIT_FILTERS: { key: AuditFilter; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'customer', label: 'Customers' },
  { key: 'invoice',  label: 'Invoices' },
  { key: 'proposal', label: 'Proposals' },
]

export function isAuditEntityType(v: unknown): v is AuditEntityType {
  return v === 'customer' || v === 'invoice' || v === 'proposal'
}

/**
 * Where a record lives, or null when there's nowhere to go.
 *
 * The page's version was two `if`s and then a bare
 * `return \`/invoices/${entityId}\`` — so any entity type added server-side
 * later, or any malformed row, produced a confident link to an invoice that
 * doesn't exist. An unrecognised type gets no link at all now.
 */
export function recordPath(
  entry: Pick<AuditLogEntry, 'action' | 'entityType' | 'entityId'>,
): string | null {
  if (entry.action === 'deleted') return null
  if (!entry.entityId) return null
  switch (entry.entityType) {
    case 'customer': return `/records/${entry.entityId}`
    case 'invoice':  return `/invoices/${entry.entityId}`
    case 'proposal': return `/proposals/${entry.entityId}`
    default:         return null
  }
}

// ── Actor ─────────────────────────────────────────────────────────────────────

/** What the trigger writes when no name was recorded on the document. */
export const UNKNOWN_ACTOR = 'Unknown'

export interface Actor {
  label: string
  /** True when nobody was recorded — distinct from a person called Unknown. */
  unattributed: boolean
  /** True when an automation stamped itself. */
  automated: boolean
}

/**
 * How to present `changedBy`.
 *
 * The trigger reads `lastEditedByName` off the document, so a write path that
 * doesn't set it lands here as the literal string "Unknown" — which the page
 * rendered as though it were somebody's name. The automations engine stamps
 * `Automation: {rule name}`, so that case is identifiable and worth marking
 * apart from "we genuinely don't know".
 */
export function actorOf(changedBy: string): Actor {
  const raw = (changedBy ?? '').trim()
  if (!raw || raw === UNKNOWN_ACTOR) {
    return { label: 'Not recorded', unattributed: true, automated: false }
  }
  if (raw.startsWith('Automation:')) {
    return { label: raw, unattributed: false, automated: true }
  }
  return { label: raw, unattributed: false, automated: false }
}

// ── Values ────────────────────────────────────────────────────────────────────

/**
 * The marker the trigger appends when it clips a value.
 *
 * Values were sliced to 80 (objects) or 120 (scalars) characters with no
 * indication, so a Line Items diff rendered as a JSON fragment that simply
 * stopped mid-structure and read as the whole value.
 */
export const TRUNCATION_MARKER = '…'

export function isTruncated(value: string): boolean {
  return value.endsWith(TRUNCATION_MARKER)
}

/** An empty value needs saying, not rendering as nothing. */
export function displayValue(value: string): string {
  return value.trim() === '' ? '(empty)' : value
}

// Firestore raw field names people don't need to see verbatim.
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  first: 'First Name',
  lastname: 'Last Name',
  active: 'Active',
  leadStatus: 'Lead Status',
  employeeStatus: 'Employee Status',
  paymentStatus: 'Payment Status',
  followUpDate: 'Follow-Up Date',
  quan: 'Quantity',
  adNo: 'Ad #',
  invoiceNumber: 'Invoice #',
  issueDate: 'Issue Date',
  dueDate: 'Due Date',
  taxRate: 'Tax Rate',
  lineItems: 'Line Items',
  paymentLink: 'Payment Link',
  proposalNumber: 'Proposal #',
  expiresDate: 'Expires',
  convertedInvoiceId: 'Converted Invoice',
}

export function fieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field]
    ?? field.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Matches an entry against a free-text query.
 *
 * The page offered only a four-way entity-type toggle, so the two questions an
 * audit log exists to answer — "what did this person change" and "who touched
 * this record" — both meant scrolling and reading every row.
 */
export function matchesAuditQuery(entry: AuditLogEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (entry.entityLabel.toLowerCase().includes(q)) return true
  if (entry.changedBy.toLowerCase().includes(q)) return true
  if (actorOf(entry.changedBy).label.toLowerCase().includes(q)) return true
  if (ACTION_LABELS[entry.action].toLowerCase().includes(q)) return true
  if (entry.entityType.includes(q)) return true
  return entry.changes.some(c =>
    fieldLabel(c.field).toLowerCase().includes(q) ||
    c.from.toLowerCase().includes(q) ||
    c.to.toLowerCase().includes(q),
  )
}

export function searchAuditEntries(entries: AuditLogEntry[], query: string): AuditLogEntry[] {
  const q = query.trim()
  if (!q) return entries
  return entries.filter(e => matchesAuditQuery(e, q))
}

// ── Grouping ──────────────────────────────────────────────────────────────────

export interface AuditDayGroup {
  /** `yyyy-mm-dd` in the viewer's locale, for a stable key. */
  key: string
  label: string
  entries: AuditLogEntry[]
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Day heading for a timestamp: Today, Yesterday, or the date.
 *
 * Every row carried a full absolute datestamp, so 200 rows gave 200 of them
 * and a burst of activity read as 200 unrelated events.
 */
export function dayLabel(d: Date, now: Date = new Date()): string {
  const today = localDayKey(now)
  const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const key = localDayKey(d)
  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

/** Groups an already-sorted (newest first) feed into day buckets. */
export function groupByDay(entries: AuditLogEntry[], now: Date = new Date()): AuditDayGroup[] {
  const groups: AuditDayGroup[] = []
  for (const entry of entries) {
    const key = localDayKey(entry.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.entries.push(entry)
    } else {
      groups.push({ key, label: dayLabel(entry.createdAt, now), entries: [entry] })
    }
  }
  return groups
}

/** Time of day only — the day is already in the group heading. */
export function fmtAuditTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
