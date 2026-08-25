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
