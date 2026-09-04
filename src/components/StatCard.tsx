import { Link } from 'react-router-dom'

interface Props {
  title: string
  value: string
  color?: string
  loading?: boolean
  to?: string
  className?: string
}

/**
 * `color` defaults to neutral. It used to default to indigo and every call site
 * passed its own hue, so the dashboard carried eight arbitrary metric colours —
 * "Leads are indigo, Appts are orange" encodes nothing, but a saturated number
 * reads as though it means something. The label identifies the metric; colour
 * is reserved for state (overdue, at risk) and for charted categories that
 * carry a legend.
 */
export default function StatCard({ title, value, color = 'text-gray-100', loading, to, className = '' }: Props) {
  const inner = (
    <>
      {loading ? (
        <div className="h-7 sm:h-8 w-14 bg-gray-700 rounded animate-pulse mb-1" />
      ) : (
        <span className={`text-xl sm:text-2xl font-bold leading-tight tabular-nums truncate max-w-full ${color}`}>{value}</span>
      )}
      <span className="text-xs text-gray-400 mt-1 text-center leading-tight">{title}</span>
    </>
  )

  if (to) {
    return (
      <Link to={to} className={`card flex flex-col items-center justify-center py-3 px-2 min-h-[78px] hover:bg-gray-700/50 transition-colors ${className}`}>
        {inner}
      </Link>
    )
  }

  return (
    <div className={`card flex flex-col items-center justify-center py-3 px-2 min-h-[78px] ${className}`}>
      {inner}
    </div>
  )
}
