import type { CustomerItem } from '../models/customer'

// Days since the lead was created — how long the deal has been open.
export function dealAgeDays(c: CustomerItem): number {
  return Math.max(0, Math.floor((Date.now() - c.creationDate.getTime()) / 86_400_000))
}

// Flags aging deals so a lead that's been sitting untouched stands out. The
// 30-day threshold matches the "Stale (30+ Days)" quick filter on /leads.
//
// Emphasis has to rise with age, and hue alone can't carry that: text-white
// (14.7:1 on a card) made the *healthiest* lead the loudest thing in the
// column, and amber-400 (8.8:1) outshouts red-400 (5.3:1) no matter how the
// tiers are coloured, because amber is intrinsically high-luminance. So weight
// carries the ramp monotonically and hue carries the meaning. Returns the full
// typographic treatment — callers shouldn't add their own font-weight.
export function dealAgeClasses(days: number): string {
  if (days >= 30) return 'text-red-400 font-semibold'
  if (days >= 14) return 'text-amber-400 font-medium'
  return 'text-gray-400 font-normal'
}
