import { interpolate, type MessageTemplate } from './template'

/**
 * The template picker in /records/:id's Compose modal.
 *
 * Two problems lived in the page's inline version.
 *
 * The tab list was `[...savedTemplates, ...builtIn]` and the selection was an
 * *index* into it. Saved templates arrive from a Firestore subscription a few
 * hundred milliseconds after the modal opens, and they're prepended — so index
 * 0 silently stopped meaning "Follow-Up" and started meaning "whatever the
 * first saved template is". An effect keyed on `savedTemplates.length` then
 * re-read `allTabs[tmplIdx]` and overwrote the subject and body, so anything
 * typed in that window was destroyed. Selection is keyed by identity here, and
 * the caller only refreshes content when the user hasn't edited it.
 *
 * The built-ins also interpolated by string concatenation while saved templates
 * went through `interpolate()` — two templating models in one tab strip,
 * distinguished only by a star. Built-ins are merge-tag strings now, so both
 * kinds resolve the same way and a built-in can be read as the template it is.
 */

export type ComposeMode = 'email' | 'sms'

export interface ComposeTab {
  /** Stable identity: `saved:<docId>` or `builtin:<slug>`. Never an index. */
  key: string
  label: string
  subject: string
  body: string
  saved: boolean
}

/** The variables both built-in and saved templates resolve against. */
export interface ComposeVars {
  firstName: string
  name: string
  date: string
  amount: string
  phone: string
  email: string
}

interface BuiltIn {
  slug: string
  label: string
  subject?: string
  body: string
}

/**
 * The built-in templates, as merge-tag source.
 *
 * `{{date}}` is empty when the record has no appointment, which is why the
 * appointment templates read "on {{date}}" with the preposition inside the
 * conditional segment — see `stripEmptyClauses`.
 */
const BUILTIN_EMAIL: BuiltIn[] = [
  {
    slug: 'follow-up',
    label: 'Follow-Up',
    subject: 'Following up — {{name}}',
    body: 'Hi {{firstName}},\n\nI wanted to follow up and see if you had any questions or if there\'s anything I can help you with.\n\nPlease feel free to reach out at any time.\n\nBest regards,',
  },
  {
    slug: 'appointment',
    label: 'Appointment',
    subject: 'Your appointment[ on {{date}}] — {{name}}',
    body: 'Hi {{firstName}},\n\nThis is a confirmation of your upcoming appointment[ on {{date}}].\n\nIf you need to reschedule or have any questions, don\'t hesitate to contact us.\n\nLooking forward to meeting with you!\n\nBest regards,',
  },
  {
    slug: 'thank-you',
    label: 'Thank You',
    subject: 'Thank you, {{firstName}}!',
    body: 'Hi {{firstName}},\n\nThank you so much for your business! We truly appreciate you choosing us.\n\nIf there\'s anything we can do to better serve you, please let us know.\n\nWarm regards,',
  },
  { slug: 'custom', label: 'Custom', subject: 'Hello {{firstName}}', body: '' },
]

const BUILTIN_SMS: BuiltIn[] = [
  {
    slug: 'follow-up',
    label: 'Follow-Up',
    body: 'Hi {{firstName}}, just wanted to follow up with you. Do you have any questions I can help with? Feel free to reply anytime.',
  },
  {
    slug: 'appointment',
    label: 'Appointment',
    body: 'Hi {{firstName}}, this is a reminder about your appointment[ on {{date}}]. Please reply to confirm or call us to reschedule.',
  },
  {
    slug: 'thank-you',
    label: 'Thank You',
    body: 'Hi {{firstName}}, thank you for your business! We appreciate you choosing us. Don\'t hesitate to reach out if you need anything.',
  },
  { slug: 'custom', label: 'Custom', body: '' },
]

/**
 * Drops a `[...]` segment when any merge tag inside it has no value.
 *
 * "your appointment[ on {{date}}]" has to become "your appointment", not
 * "your appointment on ", when the record carries no appointment date — which
 * the old string concatenation expressed with a ternary per sentence.
 *
 * This has to run *before* interpolate: `interpolate` replaces a known-but-
 * empty variable with an empty string, so by the time it has run there is no
 * tag left inside the brackets to test and the segment looks unconditional.
 */
export function pruneOptionalClauses(text: string, vars: ComposeVars): string {
  return text.replace(/\[([^[\]]*)\]/g, (_, inner: string) => {
    const tags = inner.match(/\{\{(\w+)\}\}/g) ?? []
    const allPresent = tags.every(tag => {
      const key = tag.slice(2, -2) as keyof ComposeVars
      return (vars[key] ?? '') !== ''
    })
    return allPresent ? inner : ''
  })
}

function resolve(text: string, vars: ComposeVars): string {
  return interpolate(
    pruneOptionalClauses(text, vars),
    vars as unknown as Record<string, string>,
  )
}

export function builtInTabs(mode: ComposeMode, vars: ComposeVars): ComposeTab[] {
  const defs = mode === 'email' ? BUILTIN_EMAIL : BUILTIN_SMS
  return defs.map(d => ({
    key: `builtin:${d.slug}`,
    label: d.label,
    subject: d.subject ? resolve(d.subject, vars) : '',
    body: d.body ? resolve(d.body, vars) : '',
    saved: false,
  }))
}

/**
 * Every tab, saved first.
 *
 * Saved templates keep their leading position — they're the company's own and
 * that ordering was deliberate — but because tabs carry keys, arriving late no
 * longer re-points the selection.
 */
export function composeTabs(
  mode: ComposeMode, saved: MessageTemplate[], vars: ComposeVars,
): ComposeTab[] {
  const savedTabs: ComposeTab[] = saved.map(t => ({
    key: `saved:${t.id}`,
    label: t.name,
    subject: resolve(t.subject ?? '', vars),
    body: resolve(t.body ?? '', vars),
    saved: true,
  }))
  return [...savedTabs, ...builtInTabs(mode, vars)]
}

/** Templates this mode can use: its own type, or one marked for both. */
export function templatesForMode(all: MessageTemplate[], mode: ComposeMode): MessageTemplate[] {
  return all.filter(t => t.type === mode || t.type === 'both')
}

/** The default selection: the first tab, whatever it turns out to be. */
export function initialKey(tabs: ComposeTab[]): string {
  return tabs[0]?.key ?? ''
}

export interface SelectionState {
  /** The key currently selected. */
  key: string
  /** True once the user has typed over the template's text. */
  dirty: boolean
}

export interface SelectionOutcome {
  /** The tab to treat as selected. */
  tab: ComposeTab | null
  /** Whether the caller should overwrite subject/body from `tab`. */
  refresh: boolean
  /** The key to store — may differ from the requested one if it vanished. */
  key: string
}

/**
 * What to do when the tab list changes underneath a live selection.
 *
 * The three cases that matter:
 *   - the key still resolves and the user has edits → keep both, touch nothing
 *   - the key still resolves and there are no edits → refresh the text, since
 *     a saved template's content can change while the modal is open
 *   - the key is gone (template deleted elsewhere) → fall back to the first
 *     tab, and only take its text if there was nothing to lose
 */
export function reconcileSelection(
  tabs: ComposeTab[], state: SelectionState,
): SelectionOutcome {
  const found = tabs.find(t => t.key === state.key)
  if (found) {
    return { tab: found, refresh: !state.dirty, key: found.key }
  }
  const fallback = tabs[0] ?? null
  return {
    tab: fallback,
    refresh: !state.dirty && fallback !== null,
    key: fallback?.key ?? '',
  }
}

/** Body and subject as one block of text, for the clipboard. */
export function clipboardText(mode: ComposeMode, subject: string, body: string): string {
  return mode === 'email' ? `Subject: ${subject}\n\n${body}` : body
}

/** The `mailto:` / `sms:` href for handing off to the OS. */
export function composeHref(
  mode: ComposeMode, to: string, subject: string, body: string,
): string {
  if (mode === 'email') {
    const params = new URLSearchParams()
    if (subject) params.set('subject', subject)
    if (body) params.set('body', body)
    const qs = params.toString()
    return `mailto:${to}${qs ? `?${qs}` : ''}`
  }
  // The `?&body=` form is what iOS Messages accepts; Android tolerates it.
  return `sms:${to}${body ? `?&body=${encodeURIComponent(body)}` : ''}`
}
