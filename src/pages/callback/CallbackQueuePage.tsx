import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'
import { usePrefStore } from '../../stores/prefStore'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'

type SortKey = 'date' | 'name' | 'salesman' | 'amount'
type CategoryFilter = 'all' | 'lead' | 'customer'

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: 'All',
  lead: 'Leads',
  customer: 'Customers',
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isCallback(c: CustomerItem): boolean {
  const cat = c.category.toLowerCase()
  if (cat === 'vendor') return c.salesman.toLowerCase() === 'yes'
  return c.callback.toLowerCase() === 'yes'
}

export default function CallbackQueuePage() {
  usePageTitle('Callback Queue')
  const companyId      = useAuthStore(s => s.companyId)
  const labels         = usePickerStore(s => s.labels)
  const coloredAvatars = usePrefStore(s => s.coloredAvatars)

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [catFilter, setCatFilter] = useState<CategoryFilter>('all')
  const [salesman, setSalesman]   = useState('')
  const [sortKey, setSortKey]     = useState<SortKey>('date')

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      items => { setAll(items); setLoading(false) },
      ()    => setLoading(false),
    )
    return unsub
  }, [companyId])

  // Unique salesman list from callback records only
  const salesmanOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of all) {
      if (!isCallback(c)) continue
      if (c.salesman && c.category.toLowerCase() !== 'vendor') set.add(c.salesman)
    }
    return [...set].sort()
  }, [all])

  const filtered = useMemo(() => {
    let items = all.filter(isCallback)

    if (catFilter !== 'all') {
      items = items.filter(c => c.category.toLowerCase() === catFilter)
    }
    if (salesman) {
      items = items.filter(c => c.salesman === salesman)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(c =>
        fullName(c).toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.salesman.toLowerCase().includes(q),
      )
    }

    items.sort((a, b) => {
      switch (sortKey) {
        case 'name':     return fullName(a).localeCompare(fullName(b))
        case 'salesman': return a.salesman.localeCompare(b.salesman)
        case 'amount':   return b.amount - a.amount
        default:         return b.creationDate.getTime() - a.creationDate.getTime()
      }
    })

    return items
  }, [all, catFilter, salesman, search, sortKey])

  const smLabel = labels.salesman ?? 'Salesman'

  // Counts per category for badge tabs
  const allCallback    = useMemo(() => all.filter(isCallback), [all])
  const countAll       = allCallback.length
  const countLeads     = allCallback.filter(c => c.category.toLowerCase() === 'lead').length
  const countCustomers = allCallback.filter(c => c.category.toLowerCase() === 'customer').length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Callback Queue</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Records marked <span className="text-green-400 font-medium">Called</span> — your active follow-up list
          </p>
        </div>
        {!loading && (
          <div className="bg-green-900/30 border border-green-700/40 rounded-xl px-4 py-2 text-center">
            <p className="text-xl font-bold text-green-400">{countAll}</p>
            <p className="text-xs text-green-500/70">total</p>
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 flex-wrap">
        {([
          { id: 'all',      count: countAll },
          { id: 'lead',     count: countLeads },
          { id: 'customer', count: countCustomers },
        ] as { id: CategoryFilter; count: number }[]).map(({ id, count }) => (
          <button
            key={id}
            onClick={() => setCatFilter(id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              catFilter === id
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {CATEGORY_LABELS[id]} {count > 0 && <span className="opacity-70">({count})</span>}
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone…"
          className="input-field flex-1 min-w-48 text-sm py-2"
        />
        {salesmanOptions.length > 0 && (
          <select
            value={salesman}
            onChange={e => setSalesman(e.target.value)}
            className="input-field text-sm py-2 pr-8 min-w-36"
          >
            <option value="">All {smLabel}s</option>
            {salesmanOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          className="input-field text-sm py-2 pr-8 min-w-32"
        >
          <option value="date">Newest first</option>
          <option value="name">Name A–Z</option>
          <option value="salesman">{smLabel}</option>
          <option value="amount">Amount</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-20 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <p className="text-2xl">📞</p>
          <p className="text-gray-400 text-sm font-medium">
            {countAll === 0 ? 'No callbacks flagged yet' : 'No records match your filters'}
          </p>
          <p className="text-gray-600 text-xs">
            Records show here when their <span className="text-gray-500">Called</span> field is set to Yes.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <CallbackRow
              key={c.id}
              customer={c}
              smLabel={smLabel}
              coloredAvatars={coloredAvatars}
            />
          ))}
          <p className="text-xs text-gray-600 text-center pt-1">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  )
}

function CallbackRow({
  customer: c,
  smLabel,
  coloredAvatars,
}: {
  customer: CustomerItem
  smLabel: string
  coloredAvatars: boolean
}) {
  const name     = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const color    = coloredAvatars ? avatarColor(name) : avatarOriginal()

  const now = new Date(); now.setHours(0, 0, 0, 0)
  const followUpOverdue = c.followUpDate && c.followUpDate < now
  const followUpToday   = c.followUpDate && c.followUpDate.toDateString() === now.toDateString()

  return (
    <div className="card flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 transition-colors group">
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
        style={{ background: color.bg }}
      >
        {c.photo ? (
          <img src={c.photo} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-semibold" style={{ color: color.text }}>{initials || '?'}</span>
        )}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <Link
            to={`/records/${c.id}`}
            className="text-sm font-semibold text-gray-100 hover:text-indigo-300 transition-colors truncate"
          >
            {name || '—'}
          </Link>
          <span className="text-xs text-gray-600 capitalize shrink-0">{c.category}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {c.phone && (
            <a href={`tel:${c.phone}`} className="text-xs text-gray-400 hover:text-white transition-colors">
              {c.phone}
            </a>
          )}
          {c.salesman && c.category.toLowerCase() !== 'vendor' && (
            <span className="text-xs text-gray-500 truncate">{smLabel}: {c.salesman}</span>
          )}
          {c.leadSource && <span className="text-xs text-gray-600">Source: {c.leadSource}</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-600">Added {fmtDate(c.creationDate)}</span>
          {c.followUpDate && (
            <span className={`text-xs font-medium ${
              followUpOverdue ? 'text-red-400' :
              followUpToday   ? 'text-yellow-400' :
              'text-blue-400'
            }`}>
              Follow-up: {fmtDate(c.followUpDate)}
              {followUpOverdue && ' (overdue)'}
              {followUpToday   && ' (today)'}
            </span>
          )}
        </div>
      </div>

      {/* Amount */}
      {c.amount > 0 && (
        <span className="text-sm font-semibold text-green-400 shrink-0">{formatCurrency(c.amount)}</span>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-1 shrink-0">
        {c.phone && (
          <a
            href={`tel:${c.phone}`}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-900/30 text-green-400 hover:bg-green-900/50 transition-colors"
            title="Call"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
            </svg>
          </a>
        )}
        {c.phone && (
          <a
            href={`sms:${c.phone}`}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 transition-colors"
            title="Text"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
            </svg>
          </a>
        )}
        <Link
          to={`/records/${c.id}`}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700/60 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
          title="Open record"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
