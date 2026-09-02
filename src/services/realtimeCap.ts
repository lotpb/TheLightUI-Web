/**
 * Shared safety cap for company-wide realtime listeners.
 *
 * Every `subscribeToX` that loads a whole collection caps the result so a large
 * company cannot pull 100k documents into the browser heap. The cap is silent
 * by nature — Firestore just returns fewer documents — so anything past it
 * disappears from the UI with no error. That is fine for a list view and
 * actively misleading for an aggregate, which is why services should also
 * report `hitCap` to their caller wherever a consumer can act on it.
 *
 * Note the caps are applied without an `orderBy`: adding one would make
 * Firestore drop documents missing that field entirely, so results are sorted
 * client-side instead. The practical consequence is that a collection at the
 * cap yields an arbitrary N documents in document-ID order, not the newest N.
 */
export const REALTIME_CAP = 5_000

/**
 * Logs once per snapshot when a subscription came back full, and reports it so
 * the caller can surface it. Centralised so every collection words it the same
 * way and the threshold lives in one place.
 */
export function warnIfCapped(
  label: string,
  size: number,
  companyId: string,
  cap: number = REALTIME_CAP,
): boolean {
  if (size < cap) return false
  console.warn(
    `[${label}] hit the ${cap}-document realtime cap for company ${companyId}. ` +
    'Results are partial — anything past the cap is not visible, and any total ' +
    'computed from them is understated.',
  )
  return true
}
