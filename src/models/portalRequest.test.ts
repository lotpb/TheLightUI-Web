import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  PORTAL_LIMITS, SERVICE_REQUEST_KEYS, descriptionRemaining, normalizePortalRequest,
  portalSubmitError, validatePortalRequest, type PortalRequestForm,
} from './portalRequest'

const rules = readFileSync('firestore.rules', 'utf8')

function form(over: Partial<PortalRequestForm> = {}): PortalRequestForm {
  return { name: 'Jane Doe', phone: '555-0100', email: 'jane@example.com', description: 'Leaking tap', preferredDate: '2026-09-24', ...over }
}

// ── The client and the rule agree ─────────────────────────────────────────────

/**
 * /portal/:token is unauthenticated, so firestore.rules does the real
 * validation. The page checked only that the description was non-empty, which
 * meant every other bound in that rule surfaced to a customer as
 * "Something went wrong. Please try again." — advice that cannot work.
 *
 * These tests read the rule and compare, so if either side moves the test
 * fails instead of the customer.
 */
describe('client limits mirror firestore.rules', () => {
  const ruleLimit = (field: string): number => {
    const m = rules.match(new RegExp(`request\\.resource\\.data\\.${field}\\.size\\(\\)\\s*<=\\s*(\\d+)`))
    if (!m) throw new Error(`no size bound for ${field} in firestore.rules`)
    return Number(m[1])
  }

  it.each(['name', 'phone', 'email', 'description', 'preferredDate', 'token'] as const)(
    'matches the rule bound for %s',
    field => {
      expect(PORTAL_LIMITS[field]).toBe(ruleLimit(field))
    },
  )

  it('sends exactly the ten keys the rule demands, in the rule order', () => {
    const block = rules.slice(rules.indexOf('function serviceRequestKeys'))
    const list = block.slice(block.indexOf('['), block.indexOf(']') + 1)
    const keys = [...list.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1])
    expect(keys).toHaveLength(10)
    expect([...SERVICE_REQUEST_KEYS]).toEqual(keys)
  })

  it('still asserts an exact shape, so a missing or extra key would fail', () => {
    // hasOnly + hasAll together. If either is dropped the payload could drift
    // without the rule noticing, which is what these key tests protect.
    expect(rules).toContain('hasOnly(serviceRequestKeys())')
    expect(rules).toContain('hasAll(serviceRequestKeys())')
  })

  it('requires the status the service hardcodes', () => {
    expect(rules).toContain("request.resource.data.status == 'new'")
    const service = readFileSync('src/services/customerPortalService.ts', 'utf8')
    expect(service).toContain("status:        'new'")
  })

  it('requires createdAt to be the server clock, which serverTimestamp() gives', () => {
    expect(rules).toContain('request.resource.data.createdAt == request.time')
    const service = readFileSync('src/services/customerPortalService.ts', 'utf8')
    expect(service).toContain('createdAt:     serverTimestamp()')
  })

  it('ties the submission to a live portal document', () => {
    expect(rules).toContain('exists(/databases/$(database)/documents/customerPortals/$(request.resource.data.token))')
    expect(rules).toContain("serviceRequestPortal().get('companyId', '')  == request.resource.data.companyId")
    expect(rules).toContain("serviceRequestPortal().get('customerId', '') == request.resource.data.customerId")
  })

  it('requires a non-empty description, which is why the client checks it first', () => {
    expect(rules).toContain('request.resource.data.description.size() > 0')
    expect(validatePortalRequest(form({ description: '' }))?.field).toBe('description')
  })
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('validatePortalRequest', () => {
  it('accepts a normal request', () => {
    expect(validatePortalRequest(form())).toBeNull()
  })

  it('requires a description', () => {
    expect(validatePortalRequest(form({ description: '   ' }))).toEqual({
      field: 'description', message: 'Please describe what you need.',
    })
  })

  it('catches a description the rule would reject, and says how long it is', () => {
    const err = validatePortalRequest(form({ description: 'x'.repeat(PORTAL_LIMITS.description + 1) }))
    expect(err?.field).toBe('description')
    expect(err?.message).toContain('4,000')
    expect(err?.message).toContain('4,001')
  })

  it('accepts a description exactly at the limit', () => {
    expect(validatePortalRequest(form({ description: 'x'.repeat(PORTAL_LIMITS.description) }))).toBeNull()
  })

  it('measures length after trimming, as the write does', () => {
    const padded = `  ${'x'.repeat(PORTAL_LIMITS.description)}  `
    expect(validatePortalRequest(form({ description: padded }))).toBeNull()
  })

  it('catches an over-long name, phone, email and date', () => {
    expect(validatePortalRequest(form({ name: 'x'.repeat(201) }))?.field).toBe('name')
    expect(validatePortalRequest(form({ phone: '5'.repeat(41) }))?.field).toBe('phone')
    expect(validatePortalRequest(form({ email: `${'x'.repeat(320)}@y.com` }))?.field).toBe('email')
    expect(validatePortalRequest(form({ preferredDate: 'x'.repeat(41) }))?.field).toBe('preferredDate')
  })

  it('allows the optional fields to be empty, as the rule does', () => {
    expect(validatePortalRequest({ name: '', phone: '', email: '', description: 'Help', preferredDate: '' })).toBeNull()
  })

  it('tolerates undefined optional fields', () => {
    expect(validatePortalRequest({ name: 'A', phone: '1', description: 'Help' })).toBeNull()
  })

  it('reports the description problem before a name problem', () => {
    // The description is the required field, so it's the one to fix first.
    const err = validatePortalRequest(form({ description: '', name: 'x'.repeat(500) }))
    expect(err?.field).toBe('description')
  })
})

describe('descriptionRemaining', () => {
  it('counts down from the limit', () => {
    expect(descriptionRemaining('')).toBe(PORTAL_LIMITS.description)
    expect(descriptionRemaining('abc')).toBe(PORTAL_LIMITS.description - 3)
  })

  it('goes negative past the limit, so the page can say by how much', () => {
    expect(descriptionRemaining('x'.repeat(PORTAL_LIMITS.description + 5))).toBe(-5)
  })
})

describe('normalizePortalRequest', () => {
  it('trims every field', () => {
    expect(normalizePortalRequest({ name: ' A ', phone: ' 1 ', email: ' e ', description: ' d ', preferredDate: ' p ' }))
      .toEqual({ name: 'A', phone: '1', email: 'e', description: 'd', preferredDate: 'p' })
  })

  it('turns absent optional fields into empty strings, which the rule requires to be strings', () => {
    expect(normalizePortalRequest({ name: 'A', phone: '1', description: 'd' }))
      .toEqual({ name: 'A', phone: '1', email: '', description: 'd', preferredDate: '' })
  })
})

// ── Error messages ────────────────────────────────────────────────────────────

/**
 * permission-denied on this collection almost always means the portal document
 * is gone — the rule does exists(/customerPortals/$(token)) — i.e. the link was
 * revoked or regenerated. "Please try again" is advice that will never work.
 */
describe('portalSubmitError', () => {
  it('says the link is dead for a denied write', () => {
    const msg = portalSubmitError({ code: 'permission-denied' })
    expect(msg).toContain('no longer valid')
    expect(msg).not.toContain('try again')
  })

  it('treats unauthenticated the same way', () => {
    expect(portalSubmitError({ code: 'unauthenticated' })).toContain('no longer valid')
  })

  it('suggests the connection for a transport failure', () => {
    expect(portalSubmitError({ code: 'unavailable' })).toContain('connection')
    expect(portalSubmitError({ code: 'deadline-exceeded' })).toContain('connection')
  })

  it('falls back without blaming the customer', () => {
    const msg = portalSubmitError(new Error('boom'))
    expect(msg).toContain('Please try again')
    expect(msg).toContain('call us')
  })

  it('survives a thrown non-object', () => {
    expect(() => portalSubmitError('nope')).not.toThrow()
    expect(() => portalSubmitError(null)).not.toThrow()
    expect(() => portalSubmitError(undefined)).not.toThrow()
  })
})

// ── The page uses it ──────────────────────────────────────────────────────────

describe('CustomerPortalPage wiring', () => {
  const raw = readFileSync('src/pages/portal/CustomerPortalPage.tsx', 'utf8')
  // Comments quote what was removed, so strip them before asserting.
  const page = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

  it('validates against the shared limits rather than just non-empty', () => {
    expect(page).toContain('validatePortalRequest')
    expect(page).not.toContain('Please describe what you need')
  })

  it('maps the failure to a message a customer can act on', () => {
    expect(page).toContain('portalSubmitError')
    expect(page).not.toContain('Something went wrong. Please try again.')
  })

  it('has no emoji left on the one customer-facing page', () => {
    for (const glyph of ['🔒', '📞', '✉', '📍', '✅', '🛠']) {
      expect(page, `${glyph} still present`).not.toContain(glyph)
    }
  })

  it('associates every label with its field', () => {
    expect(page.match(/htmlFor=/g)?.length).toBeGreaterThanOrEqual(4)
    expect(page).not.toMatch(/<label style=/)
  })

  it('announces validation failures', () => {
    expect(page).toContain('role="alert"')
  })

  it('has a real heading structure', () => {
    expect(page).toContain('<h1')
    expect(page).toContain('<h2')
  })

  it('lets a customer submit more than one request', () => {
    expect(page).toContain('Request Another Service')
    expect(page).not.toContain('{!submitted && (')
  })

  it('does not silently render an unknown status as Due', () => {
    // publicBadge owns this now, and returns "Status unknown" rather than
    // falling through — see publicTheme.test.ts, which checks it for all five
    // customer-facing pages rather than just this one.
    expect(page).toContain('publicBadge')
    expect(page).not.toContain('?? STATUS_STYLE.sent')
  })

  it('gives the day strip a selected state and a real name', () => {
    expect(page).toContain('role="radiogroup"')
    expect(page).toContain('aria-checked={selected}')
    expect(page).toContain('fully booked')
  })

  it('uses 16px inputs, so iOS Safari does not zoom on focus', () => {
    expect(page).toMatch(/fontSize: 16, \/\/|fontSize: 16,/)
  })

  it('describes the data as a snapshot rather than implying it is live', () => {
    expect(page).toContain('as of')
    expect(page).not.toContain('Portal updated')
  })

  it('has an empty state for a customer with nothing outstanding', () => {
    expect(page).toContain('Nothing outstanding')
  })
})

// ── Palette ───────────────────────────────────────────────────────────────────

/*
 * The palette contrast suite that used to live here has moved to
 * publicTheme.test.ts.
 *
 * It parsed this page's local `const C = {…}` to find the values to measure.
 * That palette is now models/publicTheme, shared with /i/:token, /p/:token,
 * /sign/:token and /f/:companyId — which all had the same defect and the same
 * #94a3b8 — so the checks moved with it and now cover five pages, every
 * documented pairing, and every status badge instead of this page's four.
 */
