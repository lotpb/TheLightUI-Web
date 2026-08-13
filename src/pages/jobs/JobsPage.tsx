import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToCustomers } from '../../services/customerService'
import { categoryMatches, fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePageTitle } from '../../hooks/usePageTitle'
import { avatarColor, AVATAR_ORIGINAL } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'

type JobStage = 'pending' | 'scheduled' | 'active' | 'complete'

const STAGE_CONFIG: {
  id: JobStage
  label: string
  colorClass: string
  barClass: string
  badgeClass: string
  emptyMsg: string
}[] = [
  { id: 'pending',   label: 'Pending',     colorClass: 'text-gray-400',   barClass: 'bg-gray-600',   badgeClass: 'bg-gray-700',   emptyMsg: 'No unscheduled jobs' },
  { id: 'scheduled', label: 'Scheduled',   colorClass: 'text-blue-400',   barClass: 'bg-blue-500',   badgeClass: 'bg-blue-600',   emptyMsg: 'No upcoming jobs' },
  { id: 'active',    label: 'In Progress', colorClass: 'text-teal-400',   barClass: 'bg-teal-500',   badgeClass: 'bg-teal-600',   emptyMsg: 'No active jobs' },
  { id: 'complete',  label: 'Complete',    colorClass: 'text-green-400',  barClass: 'bg-green-500',  badgeClass: 'bg-green-600',  emptyMsg: 'No completed jobs' },
]

const DAY_MS = 86_400_000

function getStage(c: CustomerItem, now: Date): JobStage {
  const hasSchedule = c.completionDate.getTime() > c.startDate.getTime() + DAY_MS
  if (!hasSchedule) return 'pending'
  if (c.startDate > now) return 'scheduled'
  if (c.completionDate > now) return 'active'
  return 'complete'
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const MAX_PER_COL = 30

export default function JobsPage() {
  usePageTitle('Jobs')
  const companyId    = useAuthStore(s => s.companyId)
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const [all, setAll]     = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  const now = useMemo(() => new Date(), [])

  const columns = useMemo(() => {
    const buckets: Record<JobStage, CustomerItem[]> = {
      pending: [], scheduled: [], active: [], complete: [],
    }
    for (const c of all) {
      if (!categoryMatches(c.category, 'Customer') || !c.isActive) continue
      buckets[getStage(c, now)].push(c)
    }
    buckets.scheduled.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    buckets.active.sort((a, b) => a.completionDate.getTime() - b.completionDate.getTime())
    buckets.complete.sort((a, b) => b.completionDate.getTime() - a.completionDate.getTime())
    buckets.pending.sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
    return buckets
  }, [all, now])

  const totalActive = columns.active.reduce((s, c) => s + c.amount, 0)
  const totalComplete = columns.complete.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Jobs</h1>
          <p className="text-sm text-gray-400 mt-0.5">Active customer jobs by stage</p>
        </div>
        <Link to="/customers" className="btn-secondary text-sm px-3 py-1.5">
          View Customers
        </Link>
      </div>

      {/* Summary strip */}
      {!loading && (columns.active.length > 0 || columns.complete.length > 0) && (
        <div className="flex gap-3 mb-4 flex-wrap">
          {columns.active.length > 0 && (
            <div className="bg-teal-900/30 border border-teal-700/40 rounded-xl px-4 py-2 flex items-center gap-3">
              <span className="text-xs text-teal-400 font-medium">{columns.active.length} in progress</span>
              {totalActive > 0 && <span className="text-sm font-semibold text-teal-300">{formatCurrency(totalActive)}</span>}
            </div>
          )}
          {columns.complete.length > 0 && (
            <div className="bg-green-900/30 border border-green-700/40 rounded-xl px-4 py-2 flex items-center gap-3">
              <span className="text-xs text-green-400 font-medium">{columns.complete.length} complete</span>
              {totalComplete > 0 && <span className="text-sm font-semibold text-green-300">{formatCurrency(totalComplete)}</span>}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGE_CONFIG.map(s => (
            <div key={s.id} className="shrink-0 w-64 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-24 mb-4" />
              {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-700 rounded-xl mb-2" />)}
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* ── Mobile: vertical grouped list ── */}
          <div className="md:hidden space-y-6 pb-6">
            {STAGE_CONFIG.map(({ id, label, colorClass, barClass, badgeClass, emptyMsg }) => {
              const items = columns[id]
              return (
                <div key={id}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`h-1 w-4 rounded-full ${barClass}`} />
                    <span className={`text-sm font-semibold ${colorClass}`}>{label}</span>
                    <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${badgeClass}`}>
                      {items.length}
                    </span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-500 pl-6">{emptyMsg}</p>
                  ) : (
                    <div className="space-y-2">
                      {items.slice(0, MAX_PER_COL).map(c => (
                        <JobCard key={c.id} customer={c} stage={id} coloredAvatars={coloredAvatars} />
                      ))}
                      {items.length > MAX_PER_COL && (
                        <Link to="/customers" className="block text-xs text-center text-indigo-400 hover:text-indigo-300 py-2">
                          +{items.length - MAX_PER_COL} more →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Desktop: horizontal kanban ── */}
          <div className="hidden md:flex gap-3 overflow-x-auto pb-4 items-start">
            {STAGE_CONFIG.map(({ id, label, colorClass, barClass, badgeClass, emptyMsg }) => {
              const items = columns[id]
              const shown = items.slice(0, MAX_PER_COL)
              const overflow = items.length - shown.length
              return (
                <div
                  key={id}
                  className="shrink-0 w-64 flex flex-col bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden"
                >
                  <div className={`h-1 ${barClass}`} />
                  <div className="flex items-center justify-between px-3 py-3">
                    <span className={`text-sm font-semibold ${colorClass}`}>{label}</span>
                    <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${badgeClass}`}>
                      {items.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 px-2 pb-3 overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 240px)' }}>
                    {shown.length === 0 ? (
                      <p className="text-xs text-gray-500 text-center py-8">{emptyMsg}</p>
                    ) : (
                      shown.map(c => (
                        <JobCard key={c.id} customer={c} stage={id} coloredAvatars={coloredAvatars} />
                      ))
                    )}
                    {overflow > 0 && (
                      <Link to="/customers" className="text-xs text-center text-indigo-400 hover:text-indigo-300 py-2 transition-colors">
                        +{overflow} more →
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function JobCard({
  customer: c,
  stage,
  coloredAvatars,
}: {
  customer: CustomerItem
  stage: JobStage
  coloredAvatars: boolean
}) {
  const name    = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const color   = coloredAvatars ? avatarColor(name) : AVATAR_ORIGINAL

  const now = new Date()
  const daysUntilComplete = stage === 'active'
    ? Math.ceil((c.completionDate.getTime() - now.getTime()) / 86_400_000)
    : null
  const isOverdue = daysUntilComplete !== null && daysUntilComplete < 0

  return (
    <Link
      to={`/records/${c.id}`}
      className="bg-gray-800 hover:bg-gray-700/80 rounded-xl p-3 transition-colors flex flex-col gap-2 border border-transparent hover:border-gray-700"
    >
      {/* Name row */}
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
          style={{ background: color.bg }}
        >
          {c.photo ? (
            <img src={c.photo} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-semibold" style={{ color: color.text }}>{initials || '?'}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-100 truncate">{name || '—'}</p>
          {c.phone && <p className="text-xs text-gray-400 truncate">{c.phone}</p>}
        </div>
        {c.amount > 0 && (
          <span className="text-xs font-semibold text-green-400 shrink-0">{formatCurrency(c.amount)}</span>
        )}
      </div>

      {/* Job / contractor tags */}
      <div className="flex flex-wrap gap-1">
        {c.job && (
          <span className="text-xs bg-gray-700/80 text-gray-300 px-1.5 py-0.5 rounded-full truncate max-w-[120px]">
            {c.job}
          </span>
        )}
        {c.product && (
          <span className="text-xs bg-gray-700/60 text-gray-400 px-1.5 py-0.5 rounded-full truncate max-w-[100px]">
            {c.product}
          </span>
        )}
        {c.contractor && (
          <span className="text-xs bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded-full truncate max-w-[100px]">
            {c.contractor}
          </span>
        )}
      </div>

      {/* Dates */}
      {stage !== 'pending' && (
        <div className="text-xs text-gray-500 space-y-0.5">
          {stage === 'scheduled' && (
            <p>Starts {fmtDate(c.startDate)}</p>
          )}
          {stage === 'active' && (
            <p className={isOverdue ? 'text-red-400 font-semibold' : ''}>
              {isOverdue
                ? `${Math.abs(daysUntilComplete!)}d overdue`
                : `Due ${fmtDate(c.completionDate)}`}
            </p>
          )}
          {stage === 'complete' && (
            <p className="text-green-500/70">Completed {fmtDate(c.completionDate)}</p>
          )}
        </div>
      )}

      {/* Salesman */}
      {c.salesman && (
        <p className="text-xs text-gray-500 truncate">{c.salesman}</p>
      )}
    </Link>
  )
}
