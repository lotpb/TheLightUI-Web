// Guards against javascript:/data:/other script-executable URI schemes being
// used as navigation targets or anchor hrefs. Firestore data (e.g. an
// invoice's user-entered paymentLink) is untrusted by the time it reaches a
// render or window.location sink, even though it was written by an
// authenticated user — see the invoice payment-link XSS fix.
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
