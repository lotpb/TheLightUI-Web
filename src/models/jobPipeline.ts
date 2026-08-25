import type { CustomerItem } from './customer'

export type JobStage = 'pending' | 'scheduled' | 'active' | 'complete'

export const JOB_STAGE_CONFIG: {
  id: JobStage
  label: string
  colorClass: string
  barClass: string
  badgeClass: string
  emptyMsg: string
}[] = [
  { id: 'pending',   label: 'Pending',     colorClass: 'text-gray-400',   barClass: 'bg-gray-600',   badgeClass: 'bg-gray-700',   emptyMsg: 'No unscheduled jobs' },
  { id: 'scheduled', label: 'Scheduled',   colorClass: 'text-blue-400',   barClass: 'bg-blue-500',   badgeClass: 'bg-blue-600',   emptyMsg: 'No upcoming jobs' },
  { id: 'active',    label: 'In Progress', colorClass: 'text-teal-400',   barClass: 'bg-teal-500',   badgeClass: 'bg-teal-600',   emptyMsg: 'No active jobs' },
  { id: 'complete',  label: 'Complete',    colorClass: 'text-green-400',  barClass: 'bg-green-500',  badgeClass: 'bg-green-600',  emptyMsg: 'No completed jobs' },
]

const DAY_MS = 86_400_000

export function getJobStage(c: CustomerItem, now: Date): JobStage {
  const start = c.startDate?.getTime() ?? 0
  const end   = c.completionDate?.getTime() ?? 0
  const hasSchedule = end > start + DAY_MS
  if (!hasSchedule) return 'pending'
  if ((c.startDate ?? new Date(0)) > now) return 'scheduled'
  if ((c.completionDate ?? new Date(0)) > now) return 'active'
  return 'complete'
}
