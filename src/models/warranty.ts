export interface Warranty {
  id: string
  companyId: string
  customerId: string
  customerName: string
  title: string
  provider: string
  startDate: Date
  expirationDate: Date
  notes: string
  isActive: boolean
  lastReminderSentAt: Date | null
  createdAt: Date
}

export function daysUntilExpiration(w: Pick<Warranty, 'expirationDate'>): number {
  return Math.ceil((w.expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export function isExpired(w: Pick<Warranty, 'expirationDate'>): boolean {
  return daysUntilExpiration(w) < 0
}

export function isExpiringSoon(w: Pick<Warranty, 'expirationDate'>): boolean {
  const days = daysUntilExpiration(w)
  return days >= 0 && days <= 30
}
