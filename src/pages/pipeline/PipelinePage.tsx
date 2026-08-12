import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeToCustomers } from '../../services/customerService'
import { categoryMatches, fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePageTitle } from '../../hooks/usePageTitle'
import { avatarColor, AVATAR_ORIGINAL } from '../../utils/avatarColor'
import { usePrefStore } from '../../stores/prefStore'

type Stage = 'new' | 'contacted' | 'appointment' | 'won' | 'lost'

const STAGE_CONFIG: {
  id: Stage
  label: string
  colorClass: string
  barClass: string
  badgeClass: string
  listPath: string
}[] = [
  { id: 'new',         label: 'New Lead',    colorClass: 'text-indigo-400', barClass: 'bg-indigo-500',  badgeClass: 'bg-indigo-600',  listPath: '/leads' },
  { id: 'contacted',   label: 'Contacted',   colorClass: 'text-blue-400',   barClass: 'bg-blue-500',    badgeClass: 'bg-blue-600',    listPath: '/leads' },
  { id: 'appointment', label: 'Appointment', colorClass: 'text-orange-400', barClass: 'bg-orange-500',  badgeClass: 'bg-orange-600',  listPath: '/leads' },
  { id: 'won',         label: 'Customer',    colorClass: 'text-green-400',  barClass: 'bg-green-500',   badgeClass: 'bg-green-600',   listPath: '/customers' },
  { id: 'lost',        label: 'Inactive',    colorClass: 'text-gray-400',   barClass: 'bg-gray-600',    badgeClass: 'bg-gray-700',    listPath: '/leads' },
]

const MAX_PER_COL = 25

function endOfToday(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function getStage(c: CustomerItem): Stage | null {
  // Vendors and employees don't belong in a lead pipeline
  if (categoryMatches(c.category, 'Vendor') || categoryMatches(c.category, 'Employee')) return null
  if (!c.isActive) return 'lost'
  if (categoryMatches(c.category, 'Customer')) return 'won'
  // Lead stages — priority: future appointment > contacted > new
  if (c.startDate && c.startDate > endOfToday()) return 'appointment'
  if (c.callback.toLowerCase() === 'yes') return 'contacted'
  return 'new'
}

export default function PipelinePage() {
  usePageTitle('Pipeline')
  const companyId = useAuthStore(s => s.companyId)
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)
  const [all, setAll] = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [companyId])

  const columns = useMemo(() => {
    const buckets: Record<Stage, CustomerItem[]> = {
      new: [], contacted: [], appointment: [], won: [], lost: [],
    }
    for (const c of all) {
      const stage = getStage(c)
      if (stage) buckets[stage].push(c)
    }
    // Sort each column: appointment by date asc, others by creation date desc
    buckets.appointment.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    for (const stage of ['new', 'contacted', 'won', 'lost'] as const) {
      buckets[stage].sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime())
    }
    return buckets
  }, [all])

  const wonAmount = useMemo(
    () => columns.won.reduce((s, c) => s + c.amount, 0),
    [columns.won],
  )

  return (
    <div className="px-4 py-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          <p className="text-sm text-gray-400 mt-0.5">Lead stages at a glance</p>
        </div>
        <Link to="/leads" className="btn-secondary text-sm px-3 py-1.5">
          View List
        </Link>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGE_CONFIG.map(s => (
            <div key={s.id} className="shrink-0 w-68 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-24 mb-4" />
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-gray-700 rounded-xl mb-2" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1 items-start min-h-0">
          {STAGE_CONFIG.map(({ id, label, colorClass, barClass, badgeClass, listPath }) => {
            const items = columns[id]
            const shown = items.slice(0, MAX_PER_COL)
            const overflow = items.length - shown.length
            return (
              <div
                key={id}
                className="shrink-0 w-64 flex flex-col bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden"
              >
                {/* Stage color bar */}
                <div className={`h-1 ${barClass}`} />

                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-3">
                  <span className={`text-sm font-semibold ${colorClass}`}>{label}</span>
                  <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${badgeClass}`}>
                    {items.length}
                  </span>
                </div>

                {/* Won total */}
                {id === 'won' && wonAmount > 0 && (
                  <p className="px-3 -mt-2 pb-2 text-xs text-green-400 font-medium">
                    {formatCurrency(wonAmount)} total
                  </p>
                )}

                {/* Cards */}
                <div className="flex flex-col gap-2 px-2 pb-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 230px)' }}>
                  {shown.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-8">No records</p>
                  ) : (
                    shown.map(c => (
                      <PipelineCard
                        key={c.id}
                        customer={c}
                        coloredAvatars={coloredAvatars}
                        stage={id}
                      />
                    ))
                  )}
                  {overflow > 0 && (
                    <Link
                      to={listPath}
                      className="text-xs text-center text-indigo-400 hover:text-indigo-300 py-2 transition-colors"
                    >
                      +{overflow} more →
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PipelineCard({
  customer: c,
  coloredAvatars,
  stage,
}: {
  customer: CustomerItem
  coloredAvatars: boolean
  stage: Stage
}) {
  const name = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const color = coloredAvatars ? avatarColor(name) : AVATAR_ORIGINAL

  const eot = endOfToday()
  const hasFutureAppt = c.startDate && c.startDate > eot
  const apptLabel = hasFutureAppt
    ? c.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <Link
      to={`/records/${c.id}`}
      className="bg-gray-800 hover:bg-gray-700/80 rounded-xl p-3 transition-colors flex flex-col gap-2 border border-transparent hover:border-gray-700"
    >
      {/* Name + amount row */}
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
          style={{ background: color.bg }}
        >
          {c.photo ? (
            <img src={c.photo} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-semibold" style={{ color: color.text }}>
              {initials || '?'}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-100 truncate">{name || '—'}</p>
          {c.phone && (
            <p className="text-xs text-gray-400 truncate">{c.phone}</p>
          )}
        </div>
        {c.amount > 0 && (
          <span className="text-xs font-semibold text-green-400 shrink-0">
            {formatCurrency(c.amount)}
          </span>
        )}
      </div>

      {/* Tags row */}
      {(c.salesman || apptLabel || (c.city && stage !== 'won')) && (
        <div className="flex flex-wrap gap-1">
          {c.salesman && (
            <span className="text-[10px] bg-gray-700/80 text-gray-300 px-1.5 py-0.5 rounded-full">
              {c.salesman}
            </span>
          )}
          {apptLabel && (
            <span className="text-[10px] bg-orange-900/40 text-orange-300 px-1.5 py-0.5 rounded-full">
              📅 {apptLabel}
            </span>
          )}
          {c.city && stage !== 'won' && (
            <span className="text-[10px] bg-gray-700/60 text-gray-400 px-1.5 py-0.5 rounded-full">
              {c.city}{c.state ? `, ${c.state}` : ''}
            </span>
          )}
        </div>
      )}
    </Link>
  )
}
