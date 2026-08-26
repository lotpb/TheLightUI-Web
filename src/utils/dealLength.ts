import type { CustomerItem } from '../models/customer'

// Days since the lead was created — how long the deal has been open.
export function dealAgeDays(c: CustomerItem): number {
  return Math.max(0, Math.floor((Date.now() - c.creationDate.getTime()) / 86_400_000))
}

// Flags aging deals so a lead that's been sitting untouched stands out,
// same 7/30-day-ish thresholds used elsewhere in the app (Pipeline staleness).
export function dealAgeClasses(days: number): string {
  if (days >= 30) return 'text-red-400'
  if (days >= 14) return 'text-amber-400'
  return 'text-white'
}
