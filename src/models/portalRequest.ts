/**
 * Client-side validation for the customer portal's service-request form.
 *
 * /portal/:token is the only page an actual customer fills in, and it's
 * unauthenticated — so firestore.rules does the real validation, checking an
 * exact ten-key shape, a token that resolves to a live portal document, and a
 * length bound on every field.
 *
 * The page knew none of that. It checked only that the description wasn't
 * empty, so a customer pasting a long description, or a name over 200
 * characters, tripped a rule they couldn't see and got
 * "Something went wrong. Please try again." — advice that cannot work, on the
 * one form in the product filled in by someone who can't be told to check the
 * console.
 *
 * The limits below mirror the rule exactly, and portalRequest.test.ts parses
 * firestore.rules to assert they still do. If the rule moves, that test fails
 * rather than the customer.
 */

/** The ten keys firestore.rules requires, exactly — no more, no fewer. */
export const SERVICE_REQUEST_KEYS = [
  'token', 'companyId', 'customerId', 'name', 'phone', 'email',
  'description', 'preferredDate', 'status', 'createdAt',
] as const

/** Field bounds, mirroring serviceRequestFieldsInRange() in firestore.rules. */
export const PORTAL_LIMITS = {
  name: 200,
  phone: 40,
  email: 320,
  description: 4000,
  preferredDate: 40,
  /** Not user input — read off the portal snapshot — but the rule bounds it. */
  token: 200,
} as const

export interface PortalRequestForm {
  name: string
  phone: string
  email?: string
  description: string
  preferredDate?: string
}

export interface FieldError {
  field: keyof PortalRequestForm
  message: string
}

/**
 * The first problem with the form, or null when it's submittable.
 *
 * Returns the field as well as the message so the page can point at the input
 * rather than only printing a sentence at the bottom.
 */
export function validatePortalRequest(form: PortalRequestForm): FieldError | null {
  const description = (form.description ?? '').trim()
  if (!description) {
    return { field: 'description', message: 'Please describe what you need.' }
  }
  if (description.length > PORTAL_LIMITS.description) {
    return {
      field: 'description',
      message: `That's a bit long — please keep it under ${PORTAL_LIMITS.description.toLocaleString()} characters (currently ${description.length.toLocaleString()}).`,
    }
  }

  const name = (form.name ?? '').trim()
  if (name.length > PORTAL_LIMITS.name) {
    return { field: 'name', message: `Please keep your name under ${PORTAL_LIMITS.name} characters.` }
  }

  const phone = (form.phone ?? '').trim()
  if (phone.length > PORTAL_LIMITS.phone) {
    return { field: 'phone', message: `Please keep the phone number under ${PORTAL_LIMITS.phone} characters.` }
  }

  const email = (form.email ?? '').trim()
  if (email.length > PORTAL_LIMITS.email) {
    return { field: 'email', message: `Please keep the email under ${PORTAL_LIMITS.email} characters.` }
  }

  const preferredDate = (form.preferredDate ?? '').trim()
  if (preferredDate.length > PORTAL_LIMITS.preferredDate) {
    return { field: 'preferredDate', message: 'That preferred date could not be read. Please pick one from the list.' }
  }

  return null
}

/** How many characters are left in the description, for the counter. */
export function descriptionRemaining(description: string): number {
  return PORTAL_LIMITS.description - (description ?? '').trim().length
}

/**
 * Trimmed values, which is what gets written.
 *
 * The form submitted its raw state, so a description padded with whitespace was
 * stored padded — and its length was measured against the rule *after* that
 * padding, which is how a value the customer saw as short could be rejected.
 */
export function normalizePortalRequest(form: PortalRequestForm): Required<PortalRequestForm> {
  return {
    name: (form.name ?? '').trim(),
    phone: (form.phone ?? '').trim(),
    email: (form.email ?? '').trim(),
    description: (form.description ?? '').trim(),
    preferredDate: (form.preferredDate ?? '').trim(),
  }
}

/**
 * A message a customer can act on, from whatever Firestore threw.
 *
 * `permission-denied` here almost always means the portal document is gone —
 * the rule does `exists(/customerPortals/$(token))` — i.e. the link was
 * revoked or regenerated. Telling someone to "try again" in that case is
 * advice that will never work, so the two cases are separated.
 */
export function portalSubmitError(err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : ''

  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return 'This portal link is no longer valid. Please contact us for a new one.'
  }
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return 'We could not reach the server. Check your connection and try again.'
  }
  return 'Something went wrong sending your request. Please try again, or call us.'
}
