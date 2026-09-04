import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToAllActivities } from '../../services/activityService'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, type CustomerItem } from '../../models/customer'
import { ACTIVITY_TYPES, type Activity, type ActivityType } from '../../models/activity'
import { Icon, ACTIVITY_ICONS } from '../../components/Icon'
import { useAuthStore } from '../../stores/authStore'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(d: Date): string {
  const now = Date.now()
  const diff = now - d.getTime()
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dayLabel(d: Date): string {
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
  if (d >= weekAgo) return 'This Week'
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

interface EnrichedActivity extends Activity {
  customerName: string
  customerId: string
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ActivityFeedPage() {
  usePageTitle('Activity Feed')
  const companyId = useAuthStore(s => s.companyId)

  const [activities, setActivities] = useState<Activity[]>([])
  const [customers,  setCustomers]  = useState<CustomerItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [search,  setSearch]        = useState('')
  const [typeFilter, setTypeFilter] = useState<ActivityType | 'all'>('all')

  useEffect(() => {
    let actDone = false, custDone = false
    const check = () => { if (actDone && custDone) setLoading(false) }
    const unsubAct  = subscribeToAllActivities(items => { setActivities(items); actDone = true; check() }, () => { actDone = true; check() })
    const unsubCust = subscribeToCustomers(     items => { setCustomers(items);  custDone = true; check() }, () => { custDone = true; check() })
    return () => { unsubAct(); unsubCust() }
  }, [companyId])

  // Build a fast lookup map for customer names
  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerItem>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  const enriched = useMemo<EnrichedActivity[]>(() => {
    return activities.map(a => {
      const c = customerMap.get(a.customerId)
      return { ...a, customerName: c ? fullName(c) : 'Unknown', customerId: a.customerId }
    })
  }, [activities, customerMap])

  const filtered = useMemo(() => {
    let items = enriched
    if (typeFilter !== 'all') items = items.filter(a => a.type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(a =>
        a.customerName.toLowerCase().includes(q) ||
        a.note.toLowerCase().includes(q) ||
        a.userName.toLowerCase().includes(q),
      )
    }
    return items
  }, [enriched, typeFilter, search])

  // Group by day label
  const groups = useMemo(() => {
    const seen = new Map<string, EnrichedActivity[]>()
    for (const a of filtered) {
      const label = dayLabel(a.createdAt)
      const group = seen.get(label) ?? []
      group.push(a)
      seen.set(label, group)
    }
    return [...seen.entries()]
  }, [filtered])

  // Counts per type for filter chips
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of enriched) m[a.type] = (m[a.type] ?? 0) + 1
    return m
  }, [enriched])

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity Feed</h1>
          <p className="text-sm text-gray-400 mt-0.5">All interactions across every customer</p>
        </div>
        {!loading && (
          <div className="text-right">
            <p className="text-xl font-bold text-white">{enriched.length}</p>
            <p className="text-xs text-gray-500">total entries</p>
          </div>
        )}
      </div>

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by customer, note, or rep…"
        className="input-field w-full text-sm py-2"
      />

      {/* Type filter chips */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => setTypeFilter('all')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
            typeFilter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          All ({enriched.length})
        </button>
        {ACTIVITY_TYPES.map(t => {
          const count = typeCounts[t.value] ?? 0
          if (count === 0) return null
          return (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                typeFilter === t.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              <Icon d={ACTIVITY_ICONS[t.value]} className="w-3.5 h-3.5 shrink-0" />
              <span>{t.label} ({count})</span>
            </button>
          )
        })}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-gray-700 shrink-0 mt-1" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 bg-gray-700 rounded w-48" />
                <div className="h-3 bg-gray-700/60 rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <Icon d={ACTIVITY_ICONS.note} className="w-8 h-8 mx-auto text-gray-400" />
          <p className="text-gray-400 text-sm">
            {enriched.length === 0
              ? 'No activity logged yet. Open a customer record to add the first entry.'
              : 'No entries match your search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <div key={day}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {day}
              </p>
              <div className="relative">
                {/* Vertical timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-800" aria-hidden="true" />

                <div className="space-y-0">
                  {items.map((a, idx) => {
                    const meta = ACTIVITY_TYPES.find(t => t.value === a.type) ?? ACTIVITY_TYPES[4]
                    const isLast = idx === items.length - 1
                    return (
                      <div
                        key={a.id}
                        className={`relative flex gap-3 ${isLast ? 'pb-0' : 'pb-5'}`}
                      >
                        {/* Icon bubble */}
                        <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0 z-10">
                          <Icon d={ACTIVITY_ICONS[a.type] ?? ACTIVITY_ICONS.note} className="w-4 h-4 text-gray-400" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <Link
                              to={`/records/${a.customerId}`}
                              className="text-sm font-semibold text-gray-100 hover:text-indigo-300 transition-colors"
                            >
                              {a.customerName}
                            </Link>
                            <span className="text-xs text-gray-600">·</span>
                            <span className="text-xs text-gray-500">{meta.label}</span>
                            <span className="text-xs text-gray-600">·</span>
                            <span className="text-xs text-gray-600">{a.userName}</span>
                            <span className="text-xs text-gray-700 ml-auto shrink-0">{timeAgo(a.createdAt)}</span>
                          </div>
                          {a.note && (
                            <p className="text-sm text-gray-300 mt-0.5 whitespace-pre-wrap leading-relaxed">
                              {a.note}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
