import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  PUBLIC_BADGES, PUBLIC_COLORS, PUBLIC_CONTRACTS, PUBLIC_INPUT,
  fmtPublicDate, publicBadge,
} from './publicTheme'

const hex = (h: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]

const lum = (c: [number, number, number]) => {
  const [r, g, b] = c.map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const ratio = (fg: string, bg: string) => {
  const [a, b] = [lum(hex(fg)), lum(hex(bg))].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

/**
 * These five pages are standalone by design — inline styles, no Tailwind — so
 * none of index.css's contrast work reaches them, and each invented its own
 * colours. `#94a3b8` alone appeared 32 times as the muted text role across
 * four of them, where it measures 2.56:1 on a white card.
 *
 * This suite is the substitute for the theme system they sit outside of: it
 * computes every ratio the palette claims rather than trusting a comment.
 */
describe('every documented pairing measures what it claims', () => {
  it.each(PUBLIC_CONTRACTS)('$role clears $min:1', ({ fg, bg, min }) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min)
  })

  it('covers every text role the palette defines', () => {
    const roles = PUBLIC_CONTRACTS.map(c => c.fg)
    for (const key of ['ink', 'inkMuted', 'inkSubtle', 'onBand', 'onBandStrong', 'accent', 'danger'] as const) {
      expect(roles, `${key} is never contract-checked`).toContain(PUBLIC_COLORS[key])
    }
  })
})

/**
 * Every badge on these pages failed: PAID 3.00:1, OVERDUE 3.95:1, DUE 4.24:1,
 * and the portal's Draft was 3.07:1 because it was the only one of four built
 * dark-on-dark. Labels are 11px bold — below the 18.66px that the 3:1
 * large-text exemption needs — so they are normal text.
 */
describe('status badges', () => {
  it.each(Object.entries(PUBLIC_BADGES))('%s clears 4.5:1', (_key, badge) => {
    expect(ratio(badge.color, badge.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('is dark-on-light for every one, with no dark surfaces', () => {
    for (const [key, badge] of Object.entries(PUBLIC_BADGES)) {
      expect(lum(hex(badge.bg)), `${key} has a dark surface`).toBeGreaterThan(lum(hex(badge.color)))
    }
  })

  it('labels every badge', () => {
    for (const [key, badge] of Object.entries(PUBLIC_BADGES)) {
      expect(badge.label, `${key} has no label`).toBeTruthy()
    }
  })
})

/**
 * PublicInvoicePage's statusInfo fell through to DUE for anything it didn't
 * recognise, so a status added server-side later would be presented to a
 * customer as an unpaid invoice.
 */
describe('publicBadge never guesses', () => {
  it('resolves the statuses the app actually stores', () => {
    for (const s of ['draft', 'sent', 'paid', 'overdue', 'accepted', 'declined', 'expired', 'signed']) {
      expect(publicBadge(s).label).not.toBe('Status unknown')
    }
  })

  it('is case-insensitive', () => {
    expect(publicBadge('PAID').label).toBe('Paid')
    expect(publicBadge('Overdue').label).toBe('Overdue')
  })

  it('says so for an unrecognised status rather than showing Due', () => {
    expect(publicBadge('voided').label).toBe('Status unknown')
    expect(publicBadge('').label).toBe('Status unknown')
    expect(publicBadge('partially-refunded').label).not.toBe('Due')
  })
})

describe('PUBLIC_INPUT', () => {
  it('is 16px, so iOS Safari does not zoom the page on focus', () => {
    expect(PUBLIC_INPUT.fontSize).toBe(16)
  })

  it('sets box-sizing, so a 100%-wide field with padding still fits', () => {
    expect(PUBLIC_INPUT.boxSizing).toBe('border-box')
  })
})

describe('fmtPublicDate', () => {
  it('formats a long date', () => {
    expect(fmtPublicDate(new Date(2026, 2, 5))).toBe('March 5, 2026')
  })

  it('never prints "Invalid Date" to a customer', () => {
    expect(fmtPublicDate(null)).toBe('—')
    expect(fmtPublicDate(undefined)).toBe('—')
    expect(fmtPublicDate(new Date('nope'))).toBe('—')
  })
})

/**
 * The value that started this. It survives only where it measures — on the
 * dark letterhead band, at 5.71:1 — and must never be a light-surface role.
 */
describe('#94a3b8 is confined to the dark band', () => {
  it('is the onBand role and nothing else', () => {
    expect(PUBLIC_COLORS.onBand).toBe('#94a3b8')
    expect(PUBLIC_COLORS.inkMuted).not.toBe('#94a3b8')
    expect(PUBLIC_COLORS.inkSubtle).not.toBe('#94a3b8')
    expect(PUBLIC_COLORS.ink).not.toBe('#94a3b8')
  })

  it('fails on the surfaces it used to be used on, which is the point', () => {
    expect(ratio('#94a3b8', PUBLIC_COLORS.card)).toBeLessThan(4.5)
    expect(ratio('#94a3b8', PUBLIC_COLORS.cardHead)).toBeLessThan(4.5)
  })
})

/**
 * inkSubtle passes on white (4.76:1) but not on the page background (4.34:1),
 * so it's the one role that breaks if moved. Recorded here so the next person
 * reaching for it knows.
 */
describe('inkSubtle is white-surface only', () => {
  it('passes on a card', () => {
    expect(ratio(PUBLIC_COLORS.inkSubtle, PUBLIC_COLORS.card)).toBeGreaterThanOrEqual(4.5)
  })

  it('does not pass on the page background — use inkMuted there', () => {
    expect(ratio(PUBLIC_COLORS.inkSubtle, PUBLIC_COLORS.page)).toBeLessThan(4.5)
    expect(ratio(PUBLIC_COLORS.inkMuted, PUBLIC_COLORS.page)).toBeGreaterThanOrEqual(4.5)
  })
})

// ── The pages use it ──────────────────────────────────────────────────────────

const PUBLIC_PAGES = [
  'src/pages/portal/CustomerPortalPage.tsx',
  'src/pages/invoices/PublicInvoicePage.tsx',
  'src/pages/proposals/PublicProposalPage.tsx',
  'src/pages/signing/PublicSigningPage.tsx',
  'src/pages/leadforms/PublicLeadFormPage.tsx',
]

describe.each(PUBLIC_PAGES)('%s', file => {
  const raw = readFileSync(file, 'utf8')
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

  it('draws its colours from the shared palette', () => {
    expect(src).toContain('publicTheme')
  })

  it('has no #94a3b8 outside the shared palette', () => {
    expect(src).not.toContain('#94a3b8')
  })

  it('has no emoji', () => {
    // Anything in the pictographic ranges. These pages used 🔒 📞 ✉ 📍 ✅ 🛠 ✓
    // 📄 ⏳ 💳 💰 🖨️ 🎉 — and on the contact rows the emoji was the field's
    // only label, so a screen reader announced "telephone emoji, 555-0100".
    const emoji = src.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu)
    expect(emoji ?? []).toEqual([])
  })

  it('has a top-level heading', () => {
    expect(src).toMatch(/<h1/)
  })
})

// ── The two defects every public page shared ──────────────────────────────────

/**
 * The four Tailwind auth pages are *inside* the theme system, so index.css's
 * contrast work does reach them — the premise that all eight were standalone
 * was only true of the five token routes. But two defects ran through all
 * eight, and they're the two that matter most on a form filled in by someone
 * who can't be told to refresh.
 */
const THEMED_PUBLIC_PAGES = [
  'src/pages/LoginPage.tsx',
  'src/pages/RegisterPage.tsx',
  'src/pages/join/JoinPage.tsx',
  'src/pages/TipPage.tsx',
]

/**
 * /tip is excluded: it's a pure calculator with no submission and no failure
 * state, so there is nothing for it to announce. Requiring a live region there
 * would be inventing a defect.
 */
const PAGES_THAT_CAN_FAIL = [...PUBLIC_PAGES, ...THEMED_PUBLIC_PAGES]
  .filter(f => !f.endsWith('TipPage.tsx'))

describe.each(PAGES_THAT_CAN_FAIL)('%s announces its errors', file => {
  const src = readFileSync(file, 'utf8')

  it('has a live region for whatever it tells the visitor went wrong', () => {
    // Every one of these rendered its error as a plain <p> or <div>, so a
    // screen-reader user who submitted a bad password, a too-long description
    // or a failed lead simply saw the page not change.
    expect(src).toMatch(/role="(alert|status)"/)
  })
})

describe.each([...PUBLIC_PAGES, ...THEMED_PUBLIC_PAGES])('%s labels its fields', file => {
  // Comments here discuss <label>, so they have to go before counting — the
  // same trap that made four assertions in an earlier pass match their own
  // explanatory prose.
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const labels = src.match(/<label/g) ?? []

  it('associates every label with a control', () => {
    // 11 labels across the four themed pages and 13 across the token routes
    // had no htmlFor and no input id, so not one field had an accessible name.
    const withFor = src.match(/<label[^>]*htmlFor=/g) ?? []
    expect(withFor.length).toBe(labels.length)
  })
})
