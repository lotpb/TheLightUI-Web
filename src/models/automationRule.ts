export type AutomationEntityType = 'customer' | 'invoice'
export type AutomationTriggerType = 'changes_to' | 'any_change'
export type AutomationActionType = 'set_field' | 'add_note' | 'set_followup_days' | 'send_email'

export interface AutomationTrigger {
  entityType: AutomationEntityType
  field: string
  type: AutomationTriggerType
  value: string // only used when type === 'changes_to'
}

export interface AutomationAction {
  type: AutomationActionType
  field?: string   // set_field
  value?: string   // set_field
  text?: string    // add_note
  days?: number    // set_followup_days
  subject?: string // send_email
  body?: string    // send_email
}

export interface AutomationRule {
  id: string
  companyId: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  actions: AutomationAction[]
  createdAt: Date
  updatedAt: Date
  runCount: number
  lastRunAt: Date | null
}

export interface AutomationLogEntry {
  id: string
  companyId: string
  ruleId: string
  ruleName: string
  entityType: AutomationEntityType
  entityId: string
  entityLabel: string
  actionsSummary: string
  ranAt: Date
}

export interface TriggerFieldOption {
  value: string
  label: string
  options?: string[] // if set, value must be one of these (rendered as a select)
}

export const CUSTOMER_TRIGGER_FIELDS: TriggerFieldOption[] = [
  { value: 'category',       label: 'Category',        options: ['Lead', 'Customer', 'Vendor', 'Employee'] },
  { value: 'leadStatus',     label: 'Lead Status' },
  { value: 'employeeStatus', label: 'Employee Status' },
  { value: 'paymentStatus',  label: 'Payment Status' },
  { value: 'salesman',       label: 'Sales Rep' },
  { value: 'callback',       label: 'Callback' },
]

export const INVOICE_TRIGGER_FIELDS: TriggerFieldOption[] = [
  { value: 'status', label: 'Status', options: ['draft', 'sent', 'paid', 'overdue'] },
]

export function triggerFieldsFor(entityType: AutomationEntityType): TriggerFieldOption[] {
  return entityType === 'customer' ? CUSTOMER_TRIGGER_FIELDS : INVOICE_TRIGGER_FIELDS
}

export const ACTION_TYPE_LABELS: Record<AutomationActionType, string> = {
  set_field:        'Update a field',
  add_note:         'Add a note',
  set_followup_days: 'Set follow-up date',
  send_email:       'Send an email',
}

// add_note and set_followup_days only make sense for customer records
export function actionTypesFor(entityType: AutomationEntityType): AutomationActionType[] {
  if (entityType === 'customer') return ['set_field', 'add_note', 'set_followup_days', 'send_email']
  return ['set_field', 'send_email']
}

export function describeTrigger(t: AutomationTrigger): string {
  const fields = triggerFieldsFor(t.entityType)
  const label = fields.find(f => f.value === t.field)?.label ?? t.field
  if (t.type === 'any_change') return `When ${label} changes`
  return `When ${label} changes to "${t.value}"`
}

export function describeAction(a: AutomationAction): string {
  switch (a.type) {
    case 'set_field':         return `Set ${a.field} to "${a.value}"`
    case 'add_note':          return `Add note: "${(a.text ?? '').slice(0, 40)}${(a.text ?? '').length > 40 ? '…' : ''}"`
    case 'set_followup_days': return `Set follow-up ${a.days ?? 0} day(s) from now`
    case 'send_email':        return `Email: "${a.subject ?? ''}"`
  }
}
