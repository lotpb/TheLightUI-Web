import { categoryMatches, type CustomerItem } from './customer'

export type Stage = 'new' | 'contacted' | 'appointment' | 'won' | 'lost'

export const STAGE_CONFIG: {
  id: Stage
  label: string
  colorClass: string
  barClass: string
  badgeClass: string
  dropHint: string
}[] = [
  { id: 'new',         label: 'New Lead',    colorClass: 'text-indigo-400', barClass: 'bg-indigo-500', badgeClass: 'bg-indigo-600', dropHint: 'Move to New'         },
  { id: 'contacted',   label: 'Contacted',   colorClass: 'text-blue-400',   barClass: 'bg-blue-500',   badgeClass: 'bg-blue-600',   dropHint: 'Mark as Contacted'  },
  { id: 'appointment', label: 'Appointment', colorClass: 'text-orange-400', barClass: 'bg-orange-500', badgeClass: 'bg-orange-600', dropHint: 'Set Appointment'    },
  { id: 'won',         label: 'Customer',    colorClass: 'text-green-400',  barClass: 'bg-green-500',  badgeClass: 'bg-green-600',  dropHint: 'Convert to Customer'},
  { id: 'lost',        label: 'Inactive',    colorClass: 'text-gray-400',   barClass: 'bg-gray-600',   badgeClass: 'bg-gray-700',   dropHint: 'Mark Inactive'      },
]

export function endOfToday(): Date {
  const d = new Date(); d.setHours(23, 59, 59, 999); return d
}

export function getStage(c: CustomerItem): Stage | null {
  if (categoryMatches(c.category, 'Vendor') || categoryMatches(c.category, 'Employee')) return null
  if (!c.isActive) return 'lost'
  if (categoryMatches(c.category, 'Customer')) return 'won'
  if (c.startDate && c.startDate > endOfToday()) return 'appointment'
  if (c.callback.toLowerCase() === 'yes') return 'contacted'
  return 'new'
}
