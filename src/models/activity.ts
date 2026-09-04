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
