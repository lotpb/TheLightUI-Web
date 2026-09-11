/**
 * Merge-tag substitution for bulk email, mirroring the server.
 *
 * The authority is `merge()` inside `bulkSendEmail` in
 * functions/src/outreach.ts — that is what actually goes out. This exists so
 * the compose screen can show a true preview of one recipient's message
 * before anything is sent; it is deliberately a copy rather than an import,
 * because functions/ is a separate package with its own tsconfig and build.
 * If the tag list changes there, it has to change here, and mergeTags.test.ts
 * pins the behaviour that has to match: case-insensitive, global, and a
 * missing field substitutes an empty string rather than leaving the tag in.
 */

export interface MergeFields {
  first: string
  lastname: string
  city: string
  salesman: string
}

/** The tags the server understands. Anything else is left alone. */
export const MERGE_TAGS = ['first', 'lastname', 'city', 'salesman'] as const

export function mergeTags(template: string, fields: Partial<MergeFields>): string {
  return template
    .replace(/\{first\}/gi,    fields.first    ?? '')
    .replace(/\{lastname\}/gi, fields.lastname ?? '')
    .replace(/\{city\}/gi,     fields.city     ?? '')
    .replace(/\{salesman\}/gi, fields.salesman ?? '')
}

/**
 * Tags used in a template that the server doesn't know about.
 *
 * A misspelled `{firstname}` isn't an error anywhere — it simply arrives in
 * the customer's inbox as the literal text `{firstname}`. Worth saying before
 * the send rather than after.
 */
export function unknownTags(template: string): string[] {
  const known = new Set<string>(MERGE_TAGS)
  const found = new Set<string>()
  for (const m of template.matchAll(/\{([a-z0-9_]+)\}/gi)) {
    const name = m[1].toLowerCase()
    if (!known.has(name)) found.add(m[0])
  }
  return [...found]
}
