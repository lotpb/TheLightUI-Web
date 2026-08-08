interface Props {
  title: string
  value: string
  color?: string  // Tailwind text color class
}

export default function StatCard({ title, value, color = 'text-indigo-400' }: Props) {
  return (
    <div className="card flex flex-col items-center justify-center py-3 px-2 min-h-[68px]">
      <span className={`text-base sm:text-xl font-bold leading-tight truncate max-w-full ${color}`}>{value}</span>
      <span className="text-xs text-gray-400 mt-1 text-center leading-tight">{title}</span>
    </div>
  )
}
