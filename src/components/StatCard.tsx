import { Link } from 'react-router-dom'

interface Props {
  title: string
  value: string
  color?: string
  loading?: boolean
  to?: string
  className?: string
}

export default function StatCard({ title, value, color = 'text-indigo-400', loading, to, className = '' }: Props) {
  const inner = (
    <>
      {loading ? (
        <div className="h-6 w-12 bg-gray-700 rounded animate-pulse mb-1" />
      ) : (
        <span className={`text-base sm:text-xl font-bold leading-tight truncate max-w-full ${color}`}>{value}</span>
      )}
      <span className="text-xs text-gray-400 mt-1 text-center leading-tight">{title}</span>
    </>
  )

  if (to) {
    return (
      <Link to={to} className={`card flex flex-col items-center justify-center py-3 px-2 min-h-[68px] hover:bg-gray-700/50 transition-colors ${className}`}>
        {inner}
      </Link>
    )
  }

  return (
    <div className={`card flex flex-col items-center justify-center py-3 px-2 min-h-[68px] ${className}`}>
      {inner}
    </div>
  )
}
