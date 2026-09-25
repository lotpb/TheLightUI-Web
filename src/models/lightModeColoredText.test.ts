import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { INVOICE_COLUMNS, PROPOSAL_COLUMNS } from './statusBoard'

const css = readFileSync('src/index.css', 'utf8')

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** The colour a bare `html.light-mode .text-X` rule sets, or null. */
function bareOverride(cls: string): string | null {
  const esc = cls.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const re = new RegExp(`html\\.light-mode \\.${esc}\\s*[,{][^}]*?color:\\s*(#[0-9a-f]{6})`, 'i')
  return css.match(re)?.[1] ?? null
}

// The four light-mode surfaces coloured text lands on (index.css --gray-* vars).
const SURFACES = { page: '#f1f5f9', column: '#e8eef5', card: '#ffffff', chip: '#d2dce8' }

const ADDED = [
  'text-blue-200', 'text-blue-300', 'text-green-200', 'text-green-300', 'text-red-200', 'text-red-300',
  'text-amber-300', 'text-emerald-200', 'text-emerald-300', 'text-violet-200', 'text-violet-300',
  'text-violet-500', 'text-orange-200', 'text-indigo-200', 'text-indigo-500',
]

describe('light-mode coloured text is legible', () => {
  it.each(ADDED)('%s has an override clearing 4.5:1 on every light surface', cls => {
    const color = bareOverride(cls)
    expect(color, cls).not.toBeNull()
    for (const [name, bg] of Object.entries(SURFACES)) {
      expect(contrast(color!, bg), `${cls} on ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('every pipeline column heading colour is covered', () => {
    for (const col of [...INVOICE_COLUMNS, ...PROPOSAL_COLUMNS]) {
      // Gray is var-backed and flips with the theme on its own.
      if (col.textClass.startsWith('text-gray-')) continue
      const c = bareOverride(col.textClass)
      expect(c, `${col.label} (${col.textClass})`).not.toBeNull()
      expect(contrast(c!, SURFACES.column), col.label).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the bulk Delete button is solid red with white text in light mode', () => {
    const m = css.match(/html\.light-mode \.bg-red-900\\\/60\.text-red-200 \{ background-color: (#[0-9a-f]{6}) !important; color: #fff/)
    expect(m).not.toBeNull()
    expect(contrast('#ffffff', m![1])).toBeGreaterThanOrEqual(4.5)
  })
})
