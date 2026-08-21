export type ServiceRequestStatus = 'new' | 'contacted' | 'scheduled' | 'completed' | 'dismissed'

export interface ServiceRequest {
  id: string
  companyId: string
  token: string
  customerId: string
  name: string
  phone: string
  email: string
  description: string
  preferredDate: string
  status: ServiceRequestStatus
  createdAt: Date
}

export const SERVICE_REQUEST_STATUSES: ServiceRequestStatus[] = ['new', 'contacted', 'scheduled', 'completed', 'dismissed']

export const STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  new:       'New',
  contacted: 'Contacted',
  scheduled: 'Scheduled',
  completed: 'Completed',
  dismissed: 'Dismissed',
}

export const STATUS_COLORS: Record<ServiceRequestStatus, string> = {
  new:       'bg-yellow-500/20 text-yellow-300',
  contacted: 'bg-blue-500/20 text-blue-300',
  scheduled: 'bg-indigo-500/20 text-indigo-300',
  completed: 'bg-green-500/20 text-green-300',
  dismissed: 'bg-gray-700 text-gray-400',
}
