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
  firstContactedAt: Date | null
  resolvedAt: Date | null
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

// Default SLA targets — not user-configurable yet, just benchmarks used to
// flag requests as "at risk" in the UI.
export const SLA_FIRST_CONTACT_TARGET_HOURS = 4
export const SLA_RESOLUTION_TARGET_HOURS = 72

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000
}

export function fmtDuration(hours: number): string {
  if (hours < 1)  return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

// Time-to-first-contact for a request, or elapsed time so far if still waiting.
export function firstContactHours(r: ServiceRequest, now: Date = new Date()): number {
  return hoursBetween(r.createdAt, r.firstContactedAt ?? now)
}

// Time-to-resolution for a request, or elapsed time so far if still open.
export function resolutionHours(r: ServiceRequest, now: Date = new Date()): number {
  return hoursBetween(r.createdAt, r.resolvedAt ?? now)
}

export function isFirstContactBreached(r: ServiceRequest, now: Date = new Date()): boolean {
  if (r.firstContactedAt) return hoursBetween(r.createdAt, r.firstContactedAt) > SLA_FIRST_CONTACT_TARGET_HOURS
  return hoursBetween(r.createdAt, now) > SLA_FIRST_CONTACT_TARGET_HOURS
}

export function isResolutionBreached(r: ServiceRequest, now: Date = new Date()): boolean {
  if (r.resolvedAt) return hoursBetween(r.createdAt, r.resolvedAt) > SLA_RESOLUTION_TARGET_HOURS
  return hoursBetween(r.createdAt, now) > SLA_RESOLUTION_TARGET_HOURS
}
