/**
 * Translating a saved template between the app's three merge vocabularies.
 *
 * /templates writes `{{firstName}} {{name}} {{date}} {{amount}} {{phone}}
 * {{email}}`. bulkSendEmail — which is what /blast actually sends through —
 * understands `{first} {lastname} {city} {salesman}`, single-braced and
 * lowercase. /campaigns understands `{{firstName}} {{lastName}} {{fullName}}
 * {{email}} {{phone}} {{city}} {{salesman}}`.
 *
 * Different brace counts, different casing, different fields. So a template
 * body pasted into /blast would deliver `Hi {{firstName}},` verbatim to the
 * customer — the exact failure mergeTags.test.ts and campaign.test.ts were
 * each written to prevent inside their own system.
 *
 * Rather than rewriting token handling inside live outbound email and SMS,
 * this translates on insert and reports what the destination cannot express,
 * so the composer can say so before anything is sent.
 */

/** Which vocabulary a piece of text is written in. */
export type TemplateDialect = 'template' | 'blast' | 'campaign' | 'record'

/** The underlying customer field, independent of any dialect's spelling. */
export type MergeField =
  | 'firstName' | 'lastName' | 'fullName' | 'email' | 'phone'
  | 'city' | 'salesman' | 'date' | 'amount'

/**
 * How each dialect spells each field, or null when it has no equivalent.
 *
 * `fullName` for blast is the one expansion rather than a rename: the server's
 * merge() has no full-name tag but does have both halves, so "{first}
 * {lastname}" is a faithful translation rather than a dropped token.
 */
const DIALECT_TOKENS: Record<TemplateDialect, Partial<Record<MergeField, string>>> = {
  template: {
    firstName: '{{firstName}}',
    fullName:  '{{name}}',
    email:     '{{email}}',
    phone:     '{{phone}}',
    date:      '{{date}}',
    amount:    '{{amount}}',
  },
  blast: {
    firstName: '{first}',
    lastName:  '{lastname}',
    fullName:  '{first} {lastname}',
    city:      '{city}',
    salesman:  '{salesman}',
  },
  campaign: {
    firstName: '{{firstName}}',
    lastName:  '{{lastName}}',
    fullName:  '{{fullName}}',
    email:     '{{email}}',
    phone:     '{{phone}}',
    city:      '{{city}}',
    salesman:  '{{salesman}}',
  },
  // The customer-record Email/Text composer, which resolves a template
  // through interpolate() in models/template.ts before showing it.
  record: {
    firstName: '{{firstName}}',
    fullName:  '{{name}}',
    email:     '{{email}}',
    phone:     '{{phone}}',
    date:      '{{date}}',
    amount:    '{{amount}}',
  },
}

export function dialectTokens(dialect: TemplateDialect): { field: MergeField; token: string }[] {
  return Object.entries(DIALECT_TOKENS[dialect])
    .map(([field, token]) => ({ field: field as MergeField, token: token as string }))
}

export const FIELD_LABELS: Record<MergeField, string> = {
  firstName: 'First name',
  lastName:  'Last name',
  fullName:  'Full name',
  email:     'Email address',
  phone:     'Phone number',
  city:      'City',
  salesman:  'Rep name',
  date:      'Appointment date',
  amount:    'Deal amount',
}

/** Every `{{token}}` and `{token}` occurrence, in order, with its position. */
function scanTokens(text: string): { raw: string; index: number }[] {
  const out: { raw: string; index: number }[] = []
  // Double braces first so `{{x}}` isn't read as `{` + `{x}`.
  const re = /\{\{(\w+)\}\}|\{(\w+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ raw: m[0], index: m.index })
  return out
}

/**
 * Whether a dialect matches its tokens case-insensitively.
 *
 * Not a detail to flatten — the three systems genuinely differ, and getting
 * it wrong here would mislabel a typo as valid or a valid tag as a typo:
 *
 *   blast     mergeTags.ts  .replace(/\{first\}/gi, …)     → insensitive
 *   campaign  campaign.ts   .replace(/{{firstName}}/g, …)  → sensitive
 *   template  template.ts   vars[key] lookup               → sensitive
 *
 * So `{FIRST}` reaches a blast recipient resolved, while `{{firstname}}`
 * reaches a campaign or template recipient as literal text.
 */
const CASE_INSENSITIVE: Record<TemplateDialect, boolean> = {
  template: false,
  blast:    true,
  campaign: false,
  record:   false,
}

/** The field a dialect's token refers to, or null if it isn't one of them. */
function fieldForToken(raw: string, dialect: TemplateDialect): MergeField | null {
  const entries = Object.entries(DIALECT_TOKENS[dialect]) as [MergeField, string][]
  const loose = CASE_INSENSITIVE[dialect]
  const hit = entries.find(([, token]) =>
    loose ? token.toLowerCase() === raw.toLowerCase() : token === raw)
  return hit ? hit[0] : null
}

export interface TranslationResult {
  text: string
  /**
   * Fields the source used that the destination has no token for. They're
   * left exactly as written rather than deleted, so nothing silently
   * disappears from someone's copy — but they will reach the customer as
   * literal text unless removed.
   */
  unresolved: MergeField[]
  /** Tokens that belong to no dialect at all — typos, most likely. */
  unknown: string[]
}

/**
 * Rewrites `text` from one dialect into another.
 *
 * Unrecognised tokens are preserved untouched and reported: a misspelled
 * `{{firstname}}` is not an error anywhere in this app, it simply arrives in
 * the customer's inbox as literal text.
 */
export function translateTokens(
  text: string,
  from: TemplateDialect,
  to: TemplateDialect,
): TranslationResult {
  const target = DIALECT_TOKENS[to]
  const unresolved: MergeField[] = []
  const unknown: string[] = []

  const scanned = scanTokens(text)
  let out = ''
  let cursor = 0

  for (const { raw, index } of scanned) {
    out += text.slice(cursor, index)
    cursor = index + raw.length

    const field = fieldForToken(raw, from)
    if (field === null) {
      // Not a token in the source dialect. It might still be a valid token in
      // the destination (someone hand-wrote it), in which case leave it be.
      if (fieldForToken(raw, to) === null && !unknown.includes(raw)) unknown.push(raw)
      out += raw
      continue
    }

    const replacement = target[field]
    if (replacement === undefined) {
      if (!unresolved.includes(field)) unresolved.push(field)
      out += raw
      continue
    }
    out += replacement
  }

  out += text.slice(cursor)
  return { text: out, unresolved, unknown }
}

/**
 * Tokens in `text` that `dialect` cannot resolve.
 *
 * utils/mergeTags.ts has an unknownTags() for /blast with the note that a
 * misspelling "simply arrives in the customer's inbox as the literal text —
 * worth saying before the send rather than after". /templates had no
 * equivalent, so `{{firstname}}` saved cleanly and shipped.
 */
export function unknownTokens(text: string, dialect: TemplateDialect): string[] {
  const out: string[] = []
  for (const { raw } of scanTokens(text)) {
    if (fieldForToken(raw, dialect) === null && !out.includes(raw)) out.push(raw)
  }
  return out
}

/** Sample values, so a template editor can show what it will read like. */
export const PREVIEW_VALUES: Record<MergeField, string> = {
  firstName: 'Jane',
  lastName:  'Doe',
  fullName:  'Jane Doe',
  email:     'jane@example.com',
  phone:     '(555) 123-4567',
  city:      'Boca Raton',
  salesman:  'Pete',
  date:      'Fri, Sep 25',
  amount:    '$12,400.00',
}

/**
 * Fills a template with sample data.
 *
 * The editor showed raw tokens and nothing else — the resolution happened on
 * a different page, against a customer you had to go and pick, so the one
 * thing a template is (text with holes in it) could never be seen filled in.
 * Unknown tokens stay visible so a typo stands out rather than vanishing.
 */
export function previewText(text: string, dialect: TemplateDialect = 'template'): string {
  const tokens = DIALECT_TOKENS[dialect]
  let out = text
  for (const [field, token] of Object.entries(tokens) as [MergeField, string][]) {
    // Matches exactly how this dialect matches — so a preview shows a
    // case-mismatched token unresolved when the real sender would too.
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(escaped, CASE_INSENSITIVE[dialect] ? 'gi' : 'g')
    out = out.replace(pattern, PREVIEW_VALUES[field])
  }
  return out
}

// ── SMS length ────────────────────────────────────────────────────────────────

/** GSM-7 single message; concatenated parts carry a 6-byte UDH. */
const SMS_SINGLE = 160
const SMS_CONCAT = 153

export interface SmsLength {
  characters: number
  segments: number
}

/**
 * How long an SMS template actually is once filled in.
 *
 * The editor gave a 7-row textarea and no count, on a page that authors text
 * messages where 160 characters is one billable segment — and because
 * placeholders expand, a body that looks 140 characters long in the editor
 * can go out at 190.
 */
export function smsLength(text: string, dialect: TemplateDialect = 'template'): SmsLength {
  const filled = previewText(text, dialect)
  const characters = filled.length
  const segments = characters === 0
    ? 0
    : characters <= SMS_SINGLE
      ? 1
      : Math.ceil(characters / SMS_CONCAT)
  return { characters, segments }
}
