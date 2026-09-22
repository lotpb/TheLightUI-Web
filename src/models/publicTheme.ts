/**
 * The palette for the pages a customer sees.
 *
 * /portal/:token, /i/:token, /p/:token, /sign/:token and /f/:companyId are all
 * deliberately standalone — inline styles, no Tailwind, no app chrome — because
 * they must not inherit the operator-facing dark theme. The consequence is that
 * none of index.css's contrast work reaches them, and each of the five invented
 * its own colours. `#94a3b8` alone appears 32 times across four of them as the
 * muted text role, where it measures **2.56:1 on a white card**.
 *
 * So they get their own system: one measured palette, checked by
 * publicTheme.test.ts, which computes the ratio for every documented pairing
 * rather than trusting the comments.
 *
 * Every value below is annotated with what it measures against the surface it's
 * used on. Anything that doesn't clear 4.5:1 for normal text is not in here.
 */

export const PUBLIC_COLORS = {
  /** Page background behind the document card. */
  page: '#f1f5f9',
  /** The document surface. */
  card: '#ffffff',
  /** Card headers, empty-state backgrounds. */
  cardHead: '#f8fafc',
  /** The dark letterhead / footer band. */
  band: '#1e293b',

  hairline: '#e2e8f0',
  rowLine: '#f1f5f9',
  divider: '#cbd5e1',

  /** Primary text on a light surface. 14.63:1 on card. */
  ink: '#1e293b',
  /** Strong muted text. 7.58:1 on card, 6.92:1 on page. Use on either. */
  inkMuted: '#475569',
  /**
   * Secondary text — **white surfaces only**.
   * 4.76:1 on card, but only 4.34:1 on the page background, so a value moved
   * from a card onto the page silently fails. inkMuted is the safe one.
   */
  inkSubtle: '#64748b',

  /** Text on the dark band. 5.71:1 on band. */
  onBand: '#94a3b8',
  /** Emphasis on the dark band. 9.85:1. */
  onBandStrong: '#cbd5e1',

  /** Links and primary actions. 6.29:1 with white text. */
  accent: '#4f46e5',
  accentSoft: '#eef2ff',
  /** Muted text on an accent-filled surface. 5.10:1 on accent. */
  onAccent: '#e0e7ff',

  /** Money / confirm actions. 5.02:1 with white text; #16a34a was 3.30:1. */
  positive: '#15803d',
  /** Destructive text on its own tint. 5.30:1 on dangerSoft. */
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
  dangerLine: '#fca5a5',
  positiveSoft: '#dcfce7',
  positiveLine: '#86efac',
} as const

/**
 * Status badges, all dark-on-light and all measured.
 *
 * Every one of these failed before: PAID 3.00:1, OVERDUE 3.95:1, DUE 4.24:1 —
 * and on /portal/:token, Draft was the only badge of four built dark-on-dark,
 * at 3.07:1. The labels here are 11px bold, which is below the 18.66px the 3:1
 * large-text exemption needs, so they are normal text and need 4.5:1.
 */
export const PUBLIC_BADGES = {
  draft:    { label: 'Draft',    color: '#334155', bg: '#f1f5f9' }, // 9.45:1
  due:      { label: 'Due',      color: '#1e40af', bg: '#dbeafe' }, // 7.15:1
  sent:     { label: 'Sent',     color: '#1e40af', bg: '#dbeafe' }, // 7.15:1
  overdue:  { label: 'Overdue',  color: '#991b1b', bg: '#fee2e2' }, // 6.80:1
  declined: { label: 'Declined', color: '#991b1b', bg: '#fee2e2' }, // 6.80:1
  expired:  { label: 'Expired',  color: '#78350f', bg: '#fef3c7' }, // 7.42:1
  paid:     { label: 'Paid',     color: '#166534', bg: '#dcfce7' }, // 6.49:1
  accepted: { label: 'Accepted', color: '#166534', bg: '#dcfce7' }, // 6.49:1
  signed:   { label: 'Signed',   color: '#166534', bg: '#dcfce7' }, // 6.49:1
  unknown:  { label: 'Status unknown', color: '#334155', bg: '#f1f5f9' },
} as const

export type PublicBadgeKey = keyof typeof PUBLIC_BADGES

/**
 * The badge for a status, never guessing.
 *
 * PublicInvoicePage's `statusInfo` fell through to DUE for anything it didn't
 * recognise, so a status added server-side later would have been presented to
 * a customer as an unpaid invoice.
 */
export function publicBadge(status: string): { label: string; color: string; bg: string } {
  const key = status.toLowerCase() as PublicBadgeKey
  return PUBLIC_BADGES[key] ?? PUBLIC_BADGES.unknown
}

/**
 * Every pairing this palette claims is legible, as data.
 *
 * The test walks this list and computes each ratio, so a colour changed without
 * re-measuring fails there rather than in front of a customer.
 */
export const PUBLIC_CONTRACTS: { role: string; fg: string; bg: string; min: number }[] = [
  { role: 'ink on card',            fg: PUBLIC_COLORS.ink,          bg: PUBLIC_COLORS.card,     min: 4.5 },
  { role: 'inkMuted on card',       fg: PUBLIC_COLORS.inkMuted,     bg: PUBLIC_COLORS.card,     min: 4.5 },
  { role: 'inkMuted on page',       fg: PUBLIC_COLORS.inkMuted,     bg: PUBLIC_COLORS.page,     min: 4.5 },
  { role: 'inkMuted on cardHead',   fg: PUBLIC_COLORS.inkMuted,     bg: PUBLIC_COLORS.cardHead, min: 4.5 },
  { role: 'inkSubtle on card',      fg: PUBLIC_COLORS.inkSubtle,    bg: PUBLIC_COLORS.card,     min: 4.5 },
  { role: 'onBand on band',         fg: PUBLIC_COLORS.onBand,       bg: PUBLIC_COLORS.band,     min: 4.5 },
  { role: 'onBandStrong on band',   fg: PUBLIC_COLORS.onBandStrong, bg: PUBLIC_COLORS.band,     min: 4.5 },
  { role: 'white on accent',        fg: '#ffffff',                  bg: PUBLIC_COLORS.accent,   min: 4.5 },
  { role: 'onAccent on accent',     fg: PUBLIC_COLORS.onAccent,     bg: PUBLIC_COLORS.accent,   min: 4.5 },
  { role: 'white on positive',      fg: '#ffffff',                  bg: PUBLIC_COLORS.positive, min: 4.5 },
  { role: 'accent on card',         fg: PUBLIC_COLORS.accent,       bg: PUBLIC_COLORS.card,     min: 4.5 },
  { role: 'danger on dangerSoft',   fg: PUBLIC_COLORS.danger,       bg: PUBLIC_COLORS.dangerSoft, min: 4.5 },
  { role: 'danger on card',         fg: PUBLIC_COLORS.danger,       bg: PUBLIC_COLORS.card,     min: 4.5 },
]

/** The input style every public form shares. */
export const PUBLIC_INPUT: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: `1px solid ${PUBLIC_COLORS.hairline}`,
  borderRadius: 8,
  // 16px, because anything smaller makes iOS Safari zoom the page on focus —
  // on forms only ever filled in on a phone.
  fontSize: 16,
  color: PUBLIC_COLORS.ink,
  background: PUBLIC_COLORS.card,
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'system-ui, sans-serif',
}

export const PUBLIC_INPUT_ERROR: React.CSSProperties = {
  ...PUBLIC_INPUT,
  border: `1px solid ${PUBLIC_COLORS.danger}`,
}

export const PUBLIC_FONT = 'system-ui, -apple-system, sans-serif'

/** `March 5, 2026` — the one absolute date these pages use. */
export function fmtPublicDate(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
