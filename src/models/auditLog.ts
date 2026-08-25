export type AuditEntityType = 'customer' | 'invoice'
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

export const ACTION_COLORS: Record<AuditAction, string> = {
  created: 'bg-green-500/20 text-green-300',
  updated: 'bg-blue-500/20 text-blue-300',
  deleted: 'bg-red-500/20 text-red-300',
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
}

export function fieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}
