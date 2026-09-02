import { REALTIME_CAP } from '../services/realtimeCap'

/**
 * Shown when a company-wide subscription came back at its realtime cap.
 *
 * On a list view a cap only means some rows aren't shown, and the user can
 * see that the list is long. On a page that sums, ranks or charts records it
 * is worse: every figure on screen is computed from a partial set and is
 * understated, with nothing on the page to suggest it. Pass `totals` there so
 * the wording says so outright.
 *
 * The caps are applied without an orderBy (adding one would make Firestore
 * drop documents missing that field), so a capped result is an arbitrary
 * subset in document-ID order rather than the newest N.
 */
export default function PartialDataBanner({
  totals = false,
  detail,
}: {
  totals?: boolean
  /** Overrides the default consequence sentence where neither wording fits. */
  detail?: string
}) {
  return (
    <div
      role="status"
      className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-4"
    >
      ⚠ Based on {REALTIME_CAP.toLocaleString()} records only — this company has more.
      {' '}
      {detail ?? (totals
        ? 'Every total, ranking and percentage on this page is understated.'
        : 'Some records are not shown.')}
      {' '}Contact support to raise this limit.
    </div>
  )
}
