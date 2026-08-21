export type EmailDirection = 'outbound' | 'inbound'

export interface EmailMessage {
  id: string
  companyId: string
  customerId: string
  direction: EmailDirection
  fromAddress: string
  toAddress: string
  subject: string
  body: string
  createdAt: Date
  read: boolean
}
