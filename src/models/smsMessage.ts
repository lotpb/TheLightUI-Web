export type SmsDirection = 'outbound' | 'inbound'
export type SmsStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'received'

export interface SmsMessage {
  id: string
  companyId: string
  customerId: string
  direction: SmsDirection
  fromNumber: string
  toNumber: string
  body: string
  status: SmsStatus
  errorMessage: string
  createdAt: Date
  read: boolean
}
