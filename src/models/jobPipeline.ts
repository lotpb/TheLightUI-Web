import type { CustomerItem } from './customer'

export type JobStage = 'pending' | 'scheduled' | 'active' | 'complete'

/**
 * `badgeClass` carries its own text colour now.
 *
 * The badges were a bare background plus a hardcoded `text-white` at the call
 * site, and only two of those backgrounds — teal-600 and green-600 — are in
 * index.css's white-text override group. So in light mode In Progress and
 * Complete kept white labels while Pending rendered dark navy on a pale
 * bg-gray-700 and Scheduled dark navy on blue: one row of four badges behaving
 * three different ways, two of them by accident.
 *
 * These are the pairs index.css themes for background *and* text, so each badge
 * is deliberate in both themes. Pending stays on the grays, which are
 * variable-backed and so correct either way.
 */
export const JOB_STAGE_CONFIG: {
  id: JobStage
  label: string
  colorClass: string
  barClass: string
  badgeClass: string
  emptyMsg: string
}[] = [
  { id: 'pending',   label: 'Pending',     colorClass: 'text-gray-400',   barClass: 'bg-gray-600',   badgeClass: 'bg-gray-700 text-gray-200',      emptyMsg: 'No unscheduled jobs' },
  { id: 'scheduled', label: 'Scheduled',   colorClass: 'text-blue-400',   barClass: 'bg-blue-500',   badgeClass: 'bg-blue-900/40 text-blue-400',   emptyMsg: 'No upcoming jobs' },
  { id: 'active',    label: 'In Progress', colorClass: 'text-teal-400',   barClass: 'bg-teal-500',   badgeClass: 'bg-teal-900/30 text-teal-400',   emptyMsg: 'No active jobs' },
  { id: 'complete',  label: 'Complete',    colorClass: 'text-green-400',  barClass: 'bg-green-500',  badgeClass: 'bg-green-900/40 text-green-400', emptyMsg: 'No completed jobs' },
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
