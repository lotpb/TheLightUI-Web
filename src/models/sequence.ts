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
