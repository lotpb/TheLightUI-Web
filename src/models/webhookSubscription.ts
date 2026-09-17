export type WebhookEvent =
  | 'customer.created'
  | 'invoice.created'
  | 'invoice.paid'
  | 'proposal.created'
  | 'proposal.accepted'
  | 'proposal.declined'
  | 'purchaseOrder.received'
  | 'serviceRequest.created'
  | 'signingRequest.signed'
  | 'financing.statusChanged'
  | 'email.replyReceived'
  | 'sms.replyReceived'
  | 'leadForm.submitted'

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'customer.created',
  'invoice.created',
  'invoice.paid',
  'proposal.created',
  'proposal.accepted',
  'proposal.declined',
  'purchaseOrder.received',
  'serviceRequest.created',
  'signingRequest.signed',
  'financing.statusChanged',
  'email.replyReceived',
  'sms.replyReceived',
  'leadForm.submitted',
]

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'customer.created':       'New Customer/Lead created',
  'invoice.created':        'Invoice created',
  'invoice.paid':           'Invoice marked paid',
  'proposal.created':       'Proposal created',
  'proposal.accepted':      'Proposal accepted by customer',
  'proposal.declined':      'Proposal declined by customer',
  'purchaseOrder.received': 'Purchase Order received',
  'serviceRequest.created': 'New Service Request submitted',
  'signingRequest.signed':  'E-Signature document signed',
  'financing.statusChanged': 'Financing application status changed',
  'email.replyReceived':     'Customer replied to an email',
  'sms.replyReceived':       'Customer replied by text',
  'leadForm.submitted':      'Web form submission received',
}

export type WebhookStatus = 'success' | 'failure' | null

export interface WebhookSubscription {
  id: string
  companyId: string
  url: string
  events: WebhookEvent[]
  secret: string
  enabled: boolean
  createdAt: Date
  lastTriggeredAt: Date | null
  lastStatus: WebhookStatus
  lastError: string | null
  failureCount: number
}

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomUUID().replace(/-/g, '')}`
}
