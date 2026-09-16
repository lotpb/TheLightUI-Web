export type SequenceAction = 'note' | 'followup'

export interface SequenceStep {
  delayDays: number
  action: SequenceAction
  message: string
}

export interface Sequence {
  id: string
  name: string
  description: string
  steps: SequenceStep[]
  createdAt: Date
}

export interface SequenceEnrollment {
  id: string
  companyId: string
  sequenceId: string
  sequenceName: string
  customerId: string
  customerName: string
  startedAt: Date
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  completedStepIndices: number[]
  nextStepIdx: number
  nextRunAt: Date
  createdAt: Date
}

export const ACTION_LABELS: Record<SequenceAction, string> = {
  note:     'Add Note',
  followup: 'Set Follow-Up',
}

export const STARTER_SEQUENCES: Array<Pick<Sequence, 'name' | 'description' | 'steps'>> = [
  {
    name: 'New Lead Follow-up',
    description: 'Chase a fresh lead over the first week',
    steps: [
      { delayDays: 1, action: 'note',     message: 'Sent intro email/call to new lead' },
      { delayDays: 3, action: 'followup', message: 'Call back if no response yet' },
      { delayDays: 7, action: 'followup', message: 'Final follow-up attempt this week' },
    ],
  },
  {
    name: 'Post-Sale Check-in',
    description: 'Stay in touch after closing the deal',
    steps: [
      { delayDays: 1,  action: 'note',     message: 'Thank-you message sent' },
      { delayDays: 14, action: 'followup', message: 'Check in on satisfaction' },
      { delayDays: 30, action: 'followup', message: 'Ask for a referral or review' },
    ],
  },
  {
    name: 'Missed Appointment',
    description: 'Recover a no-show quickly',
    steps: [
      { delayDays: 1, action: 'followup', message: 'Call to reschedule missed appointment' },
      { delayDays: 3, action: 'followup', message: 'Second attempt to reschedule' },
    ],
  },
]

// ── Step validation ───────────────────────────────────────────────────────────

/**
 * `delayDays` is an absolute offset from the enrollment date, not a gap from
 * the previous step — runSequences says so: "steps of 1/3/7 fire on days 1, 3
 * and 7". But the runner executes steps in *list order* and computes each
 * nextRunAt as startedAt + delayDays, so a step whose day has already passed
 * fires at the next 9 AM run.
 *
 * The editor let you save step 1 = day 30, step 2 = day 2 and said nothing,
 * which silently collapses the sequence: several steps fire on consecutive
 * mornings regardless of their numbers.
 */
export function stepsOutOfOrder(steps: Pick<SequenceStep, 'delayDays'>[]): boolean {
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].delayDays < steps[i - 1].delayDays) return true
  }
  return false
}

/** Two steps on the same day both fire on that morning, which is legal. */
export function duplicateStepDays(steps: Pick<SequenceStep, 'delayDays'>[]): number[] {
  const seen = new Map<number, number>()
  for (const s of steps) seen.set(s.delayDays, (seen.get(s.delayDays) ?? 0) + 1)
  return [...seen.entries()].filter(([, n]) => n > 1).map(([day]) => day).sort((a, b) => a - b)
}

/** Ascending by day, preserving the relative order of same-day steps. */
export function sortStepsByDay<T extends Pick<SequenceStep, 'delayDays'>>(steps: T[]): T[] {
  return steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.delayDays - b.s.delayDays || a.i - b.i)
    .map(({ s }) => s)
}

/** Last day in the sequence, or 0 when there are no steps. */
export function lastStepDay(steps: Pick<SequenceStep, 'delayDays'>[]): number {
  // Math.max(...[]) is -Infinity, which rendered as "ends day -Infinity".
  return steps.length === 0 ? 0 : Math.max(...steps.map(s => s.delayDays))
}

// ── Enrollment presentation ───────────────────────────────────────────────────

interface EnrollmentStatusMeta {
  label: string
  classes: string
}

const ENROLLMENT_STATUS: Record<SequenceEnrollment['status'], EnrollmentStatusMeta> = {
  active:    { label: 'Active',    classes: 'bg-green-500/20 text-green-300' },
  paused:    { label: 'Paused',    classes: 'bg-amber-500/20 text-amber-300' },
  completed: { label: 'Completed', classes: 'bg-gray-500/20 text-gray-300' },
  cancelled: { label: 'Cancelled', classes: 'bg-red-500/20 text-red-300' },
}

export function enrollmentStatusMeta(status: string): EnrollmentStatusMeta {
  return ENROLLMENT_STATUS[status as SequenceEnrollment['status']] ?? {
    label: status.trim() === '' ? 'Unknown' : status,
    classes: 'bg-gray-500/20 text-gray-300',
  }
}

export interface SequenceUsage {
  active: number
  paused: number
  completed: number
  cancelled: number
  /** Everything that isn't finished or abandoned — what deleting would break. */
  live: number
}

/**
 * How many people are in each sequence.
 *
 * SequenceEnrollment was fully modelled and the page showed only the
 * templates, so "how many customers are in this" — and therefore "what does
 * deleting it cost" — was unanswerable from the app.
 */
export function usageBySequence(enrollments: SequenceEnrollment[]): Record<string, SequenceUsage> {
  const out: Record<string, SequenceUsage> = {}
  for (const e of enrollments) {
    const u = out[e.sequenceId] ??= { active: 0, paused: 0, completed: 0, cancelled: 0, live: 0 }
    if (e.status === 'active')    { u.active++;    u.live++ }
    if (e.status === 'paused')    { u.paused++;    u.live++ }
    if (e.status === 'completed')  u.completed++
    if (e.status === 'cancelled')  u.cancelled++
  }
  return out
}

export const EMPTY_USAGE: SequenceUsage = { active: 0, paused: 0, completed: 0, cancelled: 0, live: 0 }
