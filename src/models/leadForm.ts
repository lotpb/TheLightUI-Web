export interface LeadFormSettings {
  companyId: string
  title: string
  subtitle: string
  thankYouMessage: string
  showPhone: boolean
  showAddress: boolean
  showMessage: boolean
  enabled: boolean
  updatedAt: Date
}

export type SubmissionStatus = 'new' | 'contacted' | 'converted'

export interface LeadSubmission {
  id: string
  companyId: string
  first: string
  lastname: string
  phone: string
  email: string
  street: string
  city: string
  state: string
  zip: string
  message: string
  submittedAt: Date
  status: SubmissionStatus
}

export const DEFAULT_FORM_SETTINGS: Omit<LeadFormSettings, 'companyId' | 'updatedAt'> = {
  title: 'Contact Us',
  subtitle: "Fill out the form below and we'll get back to you shortly.",
  thankYouMessage: "Thank you! We'll be in touch soon.",
  showPhone: true,
  showAddress: false,
  showMessage: true,
  enabled: true,
}

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Converted',
}

export const STATUS_COLORS: Record<SubmissionStatus, string> = {
  new: 'bg-blue-500/15 text-blue-300',
  contacted: 'bg-yellow-500/15 text-yellow-300',
  converted: 'bg-green-500/15 text-green-300',
}
