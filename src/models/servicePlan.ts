export type ServicePlanFrequency = 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual'

export interface ServicePlan {
  id: string
  companyId: string
  customerId: string
  customerName: string
  title: string
  frequency: ServicePlanFrequency
  nextDate: Date
  lastCompletedDate: Date | null
  notes: string
  salesman: string
  isActive: boolean
  createdAt: Date
}

export const FREQUENCY_LABELS: Record<ServicePlanFrequency, string> = {
  weekly:    'Weekly',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  biannual:  'Bi-Annual',
  annual:    'Annual',
}

/** Advance a date by one frequency interval. */
export function advanceByFrequency(date: Date, frequency: ServicePlanFrequency): Date {
  const d = new Date(date)
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7);   break
    case 'monthly':   d.setMonth(d.getMonth() + 1); break
    case 'quarterly': d.setMonth(d.getMonth() + 3); break
    case 'biannual':  d.setMonth(d.getMonth() + 6); break
    case 'annual':    d.setFullYear(d.getFullYear() + 1); break
  }
  return d
}
