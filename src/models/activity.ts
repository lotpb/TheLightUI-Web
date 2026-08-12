export type ActivityType = 'call' | 'text' | 'email' | 'visit' | 'note'

export const ACTIVITY_TYPES: { value: ActivityType; label: string; icon: string }[] = [
  { value: 'call',  label: 'Call',  icon: '📞' },
  { value: 'text',  label: 'Text',  icon: '💬' },
  { value: 'email', label: 'Email', icon: '✉️' },
  { value: 'visit', label: 'Visit', icon: '🏠' },
  { value: 'note',  label: 'Note',  icon: '📝' },
]

export interface Activity {
  id: string
  customerId: string
  companyId: string
  type: ActivityType
  note: string
  userId: string
  userName: string
  createdAt: Date
}
