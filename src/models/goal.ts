export interface GoalValues {
  revenue: number
  leads: number
  customers: number
}

export interface GoalDoc {
  companyId: string
  month: GoalValues
  quarter: GoalValues
  year: GoalValues
  updatedAt: Date
}

export const emptyGoalValues = (): GoalValues => ({ revenue: 0, leads: 0, customers: 0 })

export const emptyGoalDoc = (): Omit<GoalDoc, 'companyId' | 'updatedAt'> => ({
  month:   emptyGoalValues(),
  quarter: emptyGoalValues(),
  year:    emptyGoalValues(),
})

export type GoalPeriod = 'month' | 'quarter' | 'year'

export interface PeriodRange {
  label: string       // "August 2026"
  short: string       // "Aug"
  start: Date
  end: Date
}

export function currentPeriodRange(period: GoalPeriod, now = new Date()): PeriodRange {
  const y = now.getFullYear()
  const m = now.getMonth()

  if (period === 'month') {
    const start = new Date(y, m, 1)
    const end   = new Date(y, m + 1, 0, 23, 59, 59, 999)
    const label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })
    const short = now.toLocaleString('en-US', { month: 'short' })
    return { label, short, start, end }
  }

  if (period === 'quarter') {
    const q      = Math.floor(m / 3)
    const start  = new Date(y, q * 3, 1)
    const end    = new Date(y, q * 3 + 3, 0, 23, 59, 59, 999)
    const label  = `Q${q + 1} ${y}`
    const short  = `Q${q + 1}`
    return { label, short, start, end }
  }

  // year
  const start = new Date(y, 0, 1)
  const end   = new Date(y, 11, 31, 23, 59, 59, 999)
  return { label: String(y), short: String(y), start, end }
}
