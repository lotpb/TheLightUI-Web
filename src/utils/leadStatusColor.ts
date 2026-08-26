import { tagColor } from './tagColor'

// Matches the fixed <select> options in CustomerFormPage.tsx. Colors carry
// meaning (green = won, red = lost) rather than being assigned arbitrarily.
const LEAD_STATUS_COLORS: Record<string, string> = {
  'New':            'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  'Contacted':      'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  'Qualified':      'bg-teal-500/20 text-teal-300 border border-teal-500/30',
  'Proposal Sent':  'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  'Negotiating':    'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  'Won':            'bg-green-500/20 text-green-300 border border-green-500/30',
  'Lost':           'bg-red-500/20 text-red-300 border border-red-500/30',
}

// Falls back to the generic hash-based tag palette for legacy/custom values
// (e.g. imported data) that don't match one of the fixed options above.
export function leadStatusColor(status: string): string {
  return LEAD_STATUS_COLORS[status] ?? tagColor(status)
}
