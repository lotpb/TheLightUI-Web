export interface LeadFormSettings {
  companyId: string
  businessName: string
  title: string
  subtitle: string
  thankYouMessage: string
  showPhone: boolean
  showAddress: boolean
  showMessage: boolean
  enabled: boolean
  updatedAt: Date
}

/**
 * 'spam' is set by the onLeadSubmission trigger, never by the page.
 *
 * A validating security rule can bound what one submission looks like but
 * cannot rate-limit, so a script can still write at volume. The trigger
 * marks everything past an hourly burst threshold so the real leads stay
 * findable and the notifications stop, rather than the inbox silently
 * filling to its 5,000-document cap.
 */
export type SubmissionStatus = 'new' | 'contacted' | 'converted' | 'spam'

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
  businessName: '',
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
  spam: 'Flagged',
}

export const STATUS_COLORS: Record<SubmissionStatus, string> = {
  new: 'bg-blue-500/15 text-blue-300',
  contacted: 'bg-yellow-500/15 text-yellow-300',
  converted: 'bg-green-500/15 text-green-300',
  spam: 'bg-red-500/15 text-red-300',
}
