export type ActivityType = 'call' | 'text' | 'email' | 'visit' | 'note'

/**
 * No `icon` field any more. It held 📞 💬 ✉️ 🏠 📝, which render from Apple
 * Color Emoji and ignore `color` — so across /dashboard, /activity and the
 * record page's Activity tab, the glyph on a selected indigo type pill was the
 * same shade as one on an unselected grey pill, and none of them followed light
 * mode. ACTIVITY_ICONS in components/Icon replaces it; the mapping lives there
 * because a model shouldn't import from components/, the same reason fileIcon
 * returns a FileKind rather than a glyph.
 */
export const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
  { value: 'call',  label: 'Call'  },
  { value: 'text',  label: 'Text'  },
  { value: 'email', label: 'Email' },
  { value: 'visit', label: 'Visit' },
  { value: 'note',  label: 'Note'  },
]

export interface Activity {
  id: string
  customerId: string
  companyId: string
  type: ActivityType
  note: string
  userId: string
  userName: string
  createdAt: Date
}

/**
 * The label for a type, or null for one we don't recognise.
 *
 * Three surfaces wrote `ACTIVITY_TYPES.find(t => t.value === a.type) ?? ACTIVITY_TYPES[4]`
 * — a magic index that happens to be Note, so any sixth type, or any
 * reordering of the array above, displayed a confidently wrong label. Two of
 * them have been fixed by routing through models/activityFeed; this is for the
 * third, which renders activities without building feed rows.
 */
export function activityTypeLabel(type: string): string | null {
  return ACTIVITY_TYPES.find(t => t.value === type)?.label ?? null
}

/**
 * Colour per activity type.
 *
 * Lives here rather than beside one page's presentation code because
 * /dashboard's timeline and /records/:id's activity log both tint these
 * glyphs, and an unrecognised type has to fall back to a neutral rather than
 * inherit whatever the last branch set. Every value has a global light-mode
 * rule in index.css; dashboard.test.ts checks that stays true.
 */
export const ACTIVITY_TINT: Record<ActivityType, string> = {
  call:  'text-green-400',
  text:  'text-blue-400',
  email: 'text-indigo-400',
  visit: 'text-teal-400',
  note:  'text-gray-400',
}

/** The tint for a type, neutral when unrecognised. */
export function activityTint(type: string): string {
  return ACTIVITY_TINT[type as ActivityType] ?? 'text-gray-400'
}
