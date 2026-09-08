import { Link } from 'react-router-dom'

/**
 * Shown by a module page that's been deep-linked from a customer's Related
 * Records panel. Without it a scoped list reads as "this module is empty", and
 * there's no route back to the customer you arrived from.
 */
export default function CustomerScopeBanner({
  customerId,
  customerName,
  onClear,
}: {
  customerId: string
  customerName: string
  onClear: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-600/40 bg-indigo-600/10 px-4 py-2.5 mb-4">
      <p className="text-sm text-indigo-200 min-w-0 truncate">
        Showing only{' '}
        <Link to={`/records/${customerId}`} className="font-semibold text-white hover:underline">
          {customerName || 'this customer'}
        </Link>
      </p>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 text-xs font-medium text-indigo-300 hover:text-white transition-colors"
      >
        Show all
      </button>
    </div>
  )
}
