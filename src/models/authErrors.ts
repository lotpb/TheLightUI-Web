/**
 * Human wording for Firebase auth and storage failures.
 *
 * This started as a private `friendlyAuthError` inside authStore, which
 * covered six codes and then `return msg` — so anything unmapped reached the
 * user as `Firebase: Error (auth/requires-recent-login).`. /profile didn't use
 * it at all: it special-cased two codes inline and passed `err.message`
 * straight to a toast in four handlers.
 *
 * Lives here so both can share it, and so the fallback is a sentence rather
 * than a leaked implementation detail.
 */

/** Ordered: the first code found in the message wins. */
const MESSAGES: { code: string; message: string }[] = [
  // Credentials
  { code: 'wrong-password',        message: 'Incorrect password.' },
  { code: 'invalid-credential',    message: 'Incorrect email or password.' },
  { code: 'invalid-login-credentials', message: 'Incorrect email or password.' },
  { code: 'user-not-found',        message: 'No account found with that email.' },
  { code: 'invalid-email',         message: 'That email address isn’t valid.' },
  { code: 'user-disabled',         message: 'This account has been disabled. Contact your administrator.' },

  // Registration
  { code: 'email-already-in-use',  message: 'An account with this email already exists.' },
  { code: 'weak-password',         message: 'Password must be at least 6 characters.' },
  { code: 'operation-not-allowed', message: 'That sign-in method isn’t enabled for this project.' },

  // Session age — what updatePassword hits when the session is old, and the
  // one the old mapper had no entry for.
  { code: 'requires-recent-login', message: 'For your security, sign out and back in before changing this.' },

  // Rate limiting and transport
  { code: 'too-many-requests',       message: 'Too many attempts. Wait a few minutes and try again.' },
  { code: 'network-request-failed',  message: 'Network error. Check your connection and try again.' },
  { code: 'timeout',                 message: 'That took too long. Check your connection and try again.' },

  // Storage, for the avatar upload
  { code: 'storage/unauthorized',    message: 'You don’t have permission to upload that.' },
  { code: 'storage/canceled',        message: 'Upload cancelled.' },
  { code: 'storage/quota-exceeded',  message: 'Storage is full. Contact your administrator.' },
  { code: 'storage/retry-limit-exceeded', message: 'Upload kept failing. Check your connection and try again.' },

  // Firestore
  { code: 'permission-denied',       message: 'You don’t have permission to do that.' },
  { code: 'unavailable',             message: 'The service is temporarily unavailable. Try again shortly.' },
]

/**
 * A sentence the user can act on.
 *
 * `fallback` is deliberately required rather than defaulted to the raw
 * message: every caller has to decide what to say when the cause is unknown,
 * which is what stops `Firebase: Error (auth/…)` reaching a toast.
 */
export function friendlyAuthError(err: unknown, fallback: string): string {
  const raw = errorText(err)
  if (!raw) return fallback
  for (const { code, message } of MESSAGES) {
    if (raw.includes(code)) return message
  }
  return fallback
}

/** The searchable text of whatever was thrown. */
function errorText(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    return `${typeof code === 'string' ? code : ''} ${err.message}`
  }
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code
    const message = (err as { message?: unknown }).message
    return `${typeof code === 'string' ? code : ''} ${typeof message === 'string' ? message : ''}`
  }
  return ''
}

/** True when the failure means "prove it's you again", so the UI can say so. */
export function needsReauth(err: unknown): boolean {
  return errorText(err).includes('requires-recent-login')
}
