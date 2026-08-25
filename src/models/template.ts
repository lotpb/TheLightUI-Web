export type TemplateType = 'email' | 'sms' | 'both'

export interface MessageTemplate {
  id: string
  name: string
  type: TemplateType
  subject: string
  body: string
  createdAt: Date
  updatedAt: Date
}

export const PLACEHOLDERS = [
  { token: '{{firstName}}', desc: 'First name' },
  { token: '{{name}}',      desc: 'Full name' },
  { token: '{{date}}',      desc: 'Appointment date' },
  { token: '{{amount}}',    desc: 'Deal amount' },
  { token: '{{phone}}',     desc: 'Phone number' },
  { token: '{{email}}',     desc: 'Email address' },
]

export const STARTER_TEMPLATES: Array<Pick<MessageTemplate, 'name' | 'type' | 'subject' | 'body'>> = [
  {
    name: 'Follow-up after visit',
    type: 'both',
    subject: 'Great meeting you, {{firstName}}!',
    body: 'Hi {{firstName}}, thanks for taking the time to meet with us. Let me know if you have any questions — happy to help however I can!',
  },
  {
    name: 'Missed call',
    type: 'sms',
    subject: '',
    body: "Hi {{firstName}}, sorry we missed you! Give us a call back at your convenience or reply here.",
  },
  {
    name: 'Quote reminder',
    type: 'both',
    subject: 'Following up on your quote',
    body: 'Hi {{firstName}}, just checking in on the quote for {{amount}} we sent over. Let us know if you have any questions or would like to move forward.',
  },
  {
    name: 'Appointment reminder',
    type: 'sms',
    subject: '',
    body: 'Hi {{firstName}}, this is a reminder of your appointment on {{date}}. Reply to confirm or let us know if you need to reschedule.',
  },
]

export function interpolate(
  text: string,
  vars: Partial<Record<string, string>>,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}
