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
  /**
   * Filenames only — the webhook used to discard attachments entirely, so a
   * reply saying "photos attached" looked like it had none. The files
   * themselves aren't stored yet.
   */
  attachmentNames: string[]
}
