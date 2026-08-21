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

export function interpolate(
  text: string,
  vars: Partial<Record<string, string>>,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}
