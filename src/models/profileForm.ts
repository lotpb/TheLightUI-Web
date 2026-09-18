/**
 * Validation and display logic for /profile.
 *
 * The page enforced its password rules with toasts fired on submit — nothing
 * stated the requirement beforehand, so a typo in a masked field was only
 * discoverable by failing — and it had no notion of whether anything had
 * changed, so Save was always enabled and navigating away lost edits in
 * silence.
 */

export interface ProfileDraft {
  firstName: string
  lastName: string
}

/**
 * How the stored profile was loaded.
 *
 * The page had no such state: `getDoc(...).then(...)` with no `.catch()` meant
 * a failed read left both name fields empty and indistinguishable from "no
 * name set" — and saving then wrote those empty strings over the real name,
 * plus `displayName: null` on the auth record.
 */
export type ProfileLoadState = 'loading' | 'loaded' | 'failed'

export function profileDirty(draft: ProfileDraft, saved: ProfileDraft | null): boolean {
  if (saved === null) return false   // nothing to compare against yet
  return draft.firstName.trim() !== saved.firstName.trim()
      || draft.lastName.trim() !== saved.lastName.trim()
}

/** The auth `displayName` a draft produces, or null when it would be empty. */
export function displayNameFor(draft: ProfileDraft): string | null {
  const joined = [draft.firstName.trim(), draft.lastName.trim()].filter(Boolean).join(' ')
  return joined || null
}

export function initialsFor(draft: ProfileDraft): string {
  return [draft.firstName.trim()[0], draft.lastName.trim()[0]]
    .filter(Boolean).join('').toUpperCase()
}

// ── Password rules ────────────────────────────────────────────────────────────

/** Firebase's own floor. Stated up front now instead of only on failure. */
export const PASSWORD_MIN_LENGTH = 6

export interface PasswordCheck {
  id: 'length' | 'match'
  label: string
  /** Null until there's enough input to judge, so nothing shows red on an
   *  untouched form. */
  met: boolean | null
}

export function passwordChecks(newPw: string, confirmPw: string): PasswordCheck[] {
  return [
    {
      id: 'length',
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      met: newPw.length === 0 ? null : newPw.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: 'match',
      label: 'Both entries match',
      met: confirmPw.length === 0 ? null : newPw === confirmPw,
    },
  ]
}

/**
 * Why the password form can't be submitted, or null when it can.
 *
 * Current password is included because reauthentication needs it and an empty
 * one produced a Firebase error rather than a sentence.
 */
export function passwordIssue(
  currentPw: string, newPw: string, confirmPw: string,
): string | null {
  if (!currentPw) return 'Enter your current password.'
  if (!newPw) return 'Enter a new password.'
  if (newPw.length < PASSWORD_MIN_LENGTH) {
    return `New password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (!confirmPw) return 'Confirm your new password.'
  if (newPw !== confirmPw) return 'The two new passwords don’t match.'
  if (newPw === currentPw) return 'The new password is the same as your current one.'
  return null
}

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * Human wording for a role claim.
 *
 * `role` and `companyId` were both in the auth store and neither appeared on
 * the page — on a CRM where `viewer` silently blocks writes app-wide, what you
 * are is the most useful line a profile can carry.
 */
export function roleLabel(role: string | null | undefined): string {
  switch ((role ?? '').toLowerCase()) {
    case 'owner':  return 'Owner'
    case 'admin':  return 'Admin'
    case 'viewer': return 'Viewer (read-only)'
    case 'member':
    case 'user':   return 'Member'
    case '':       return 'Role not set'
    default:       return role as string
  }
}

/** Whether to explain that this role can't change records. */
export function roleIsReadOnly(role: string | null | undefined): boolean {
  return (role ?? '').toLowerCase() === 'viewer'
}
