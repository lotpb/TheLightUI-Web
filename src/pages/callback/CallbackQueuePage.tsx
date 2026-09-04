import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers, setCalledFlag } from '../../services/customerService'
import { fullName, displayName, formatCurrency, type CustomerItem } from '../../models/customer'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'
import { usePrefStore } from '../../stores/prefStore'
import { avatarColor, avatarOriginal } from '../../utils/avatarColor'
import { Icon, ICONS } from '../../components/Icon'
import ConfirmModal from '../../components/ConfirmModal'

type SortKey = 'followUp' | 'date' | 'name' | 'salesman' | 'amount'
type CategoryFilter = 'all' | 'lead' | 'customer' | 'vendor'

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: 'All',
  lead: 'Leads',
  customer: 'Customers',
  // Vendors keep the called flag in `salesman` (see isCallback), so they can
  // appear here — but they had no tab, so "All" counted them while
  // Leads + Customers didn't and the numbers never added up.
  vendor: 'Vendors',
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Follow-up urgency. Deliberately local-midnight, not the shared utils/dueDate
 * helper: that one is UTC-based because task due dates are written as UTC
 * midnight, whereas followUpDate is written by CustomerFormPage's DateField as
 * `new Date(value + 'T00:00:00')` — local midnight. Using the UTC helper here
 * would shift every follow-up by a day west of UTC.
 */
type FollowUpState = 'overdue' | 'today' | 'upcoming' | 'none'

function followUpState(d: Date | null): FollowUpState {
  if (!d) return 'none'
  const today = startOfToday()
  const due = new Date(d)
  due.setHours(0, 0, 0, 0)
  if (due < today) return 'overdue'
  if (due.getTime() === today.getTime()) return 'today'
  return 'upcoming'
}

/** Sort rank: overdue first, then today, then scheduled, then unscheduled. */
const FOLLOW_UP_RANK: Record<FollowUpState, number> = {
  overdue: 0, today: 1, upcoming: 2, none: 3,
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
  const [sortKey, setSortKey]     = useState<SortKey>('followUp')
  // Confirmed before writing: clearing the flag makes the row vanish from the
  // list, so a mis-click would look like the record disappeared.
  const [pendingClear, setPendingClear] = useState<CustomerItem | null>(null)
  const [clearError, setClearError] = useState<string | null>(null)

  async function confirmClear() {
    const target = pendingClear
    if (!target) return
    setPendingClear(null)
    try {
      await setCalledFlag(target.id, target.category, false)
    } catch (err) {
      setClearError(err instanceof Error ? err.message : 'Could not update the record.')
    }
  }

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
        case 'date':     return b.creationDate.getTime() - a.creationDate.getTime()
        default: {
          // Urgency first. The old default was creation date, so a queue meant
          // for "who do I contact next" led with whoever was added most
          // recently, regardless of whether anyone was overdue.
          const ra = FOLLOW_UP_RANK[followUpState(a.followUpDate)]
          const rb = FOLLOW_UP_RANK[followUpState(b.followUpDate)]
          if (ra !== rb) return ra - rb
          // Within a bucket, soonest due first; unscheduled fall back to newest.
          if (a.followUpDate && b.followUpDate) {
            return a.followUpDate.getTime() - b.followUpDate.getTime()
          }
          return b.creationDate.getTime() - a.creationDate.getTime()
        }
      }
    })

    return items
  }, [all, catFilter, salesman, search, sortKey])

  const smLabel = labels.salesman ?? 'Salesman'

  // Counts per category for badge tabs
  const allCallback = useMemo(() => all.filter(isCallback), [all])
  const counts = useMemo(() => {
    const c: Record<CategoryFilter, number> = { all: allCallback.length, lead: 0, customer: 0, vendor: 0 }
    for (const r of allCallback) {
      const cat = r.category.toLowerCase()
      if (cat === 'lead' || cat === 'customer' || cat === 'vendor') c[cat]++
    }
    return c
  }, [allCallback])

  // Anything whose category isn't one of the three tabs is reachable only under
  // "All", so surface that rather than letting the tabs quietly disagree.
  const untabbed = counts.all - (counts.lead + counts.customer + counts.vendor)
  const overdueCount = useMemo(
    () => allCallback.filter(c => followUpState(c.followUpDate) === 'overdue').length,
    [allCallback],
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header.
          The old copy called this "your active follow-up list" while describing
          the field as "marked Called" in the same sentence — a queue of work
          outstanding and a log of work done, at once. leadScore.ts scores the
          same flag as 'Has been called', so it records contact having happened.
          This states the rule and the ordering instead of characterising the
          intent, which is what made the two readings possible.
          The green total badge is gone: it repeated the "All" tab count
          directly below it. */}
      <div>
        <h1 className="text-2xl font-bold text-white">Callbacks</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Records whose <span className="text-gray-200 font-medium">Called</span> field is Yes, ordered by
          follow-up date.
          {!loading && overdueCount > 0 && (
            <> <span className="text-red-400 font-medium">{overdueCount} overdue</span>.</>
          )}
        </p>
      </div>

      {clearError && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm">
          {clearError}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'lead', 'customer', 'vendor'] as CategoryFilter[])
          .filter(id => id === 'all' || counts[id] > 0)
          .map(id => {
            const count = counts[id]
            return (
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
            )
          })}
      </div>

      {/* If a record's category isn't one of the tabs it's only reachable under
          "All", which is how the counts used to silently disagree. */}
      {!loading && untabbed > 0 && (
        <p className="text-xs text-gray-400">
          {untabbed} record{untabbed !== 1 ? 's' : ''} in another category — visible under All.
        </p>
      )}

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
          <option value="followUp">Follow-up date</option>
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
        <div className="card p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-700/50 flex items-center justify-center mx-auto mb-4">
            <Icon d={ICONS.phone} className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-gray-100 text-sm font-medium mb-1">
            {counts.all === 0 ? 'No callbacks flagged yet' : 'No records match your filters'}
          </p>
          <p className="text-gray-400 text-xs">
            Records appear here when their <span className="text-gray-200 font-medium">Called</span> field is set to Yes.
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
              onClear={setPendingClear}
            />
          ))}
          <p className="text-xs text-gray-400 text-center pt-1">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      <ConfirmModal
        isOpen={pendingClear !== null}
        message={
          pendingClear
            ? `Clear the Called flag for ${displayName(pendingClear) || 'this record'}? It will drop off this list. You can set it again from the record.`
            : ''
        }
        confirmLabel="Clear"
        onConfirm={confirmClear}
        onCancel={() => setPendingClear(null)}
      />
    </div>
  )
}

const FOLLOW_UP_PILL: Record<Exclude<FollowUpState, 'none'>, string> = {
  overdue:  'bg-red-500/15 text-red-300 border-red-500/30',
  today:    'bg-amber-500/15 text-amber-300 border-amber-500/30',
  upcoming: 'bg-gray-700/60 text-gray-300 border-gray-600',
}

function CallbackRow({
  customer: c,
  smLabel,
  coloredAvatars,
  onClear,
}: {
  customer: CustomerItem
  smLabel: string
  coloredAvatars: boolean
  onClear: (c: CustomerItem) => void
}) {
  // displayName handles the vendor case (whole name in `first`, nothing in
  // `lastname`) and company-named records; taking initials from it fixes the
  // vendor "Bulbs Inc" -> "B" that the raw first[0]+lastname[0] produced.
  const name = displayName(c)
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
  const color = coloredAvatars ? avatarColor(name) : avatarOriginal()

  const fu = followUpState(c.followUpDate)
  const isVendor = c.category.toLowerCase() === 'vendor'

  // Second line, in priority order. Six fields used to be spread over three
  // lines all at text-xs, separated only by gray-400/500/600 — a hierarchy
  // carried by a distinction that sat at or below the contrast floor.
  const meta = [
    !isVendor && c.salesman ? `${smLabel}: ${c.salesman}` : '',
    c.leadSource ? `Source: ${c.leadSource}` : '',
    `Added ${fmtDate(c.creationDate)}`,
  ].filter(Boolean)

  return (
    <div className="card flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 transition-colors">
      {/* w-8 to match every other list row in the app (leads, customers,
          dashboard, pipeline); this one was w-10. */}
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

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/records/${c.id}`}
            className="text-sm font-semibold text-gray-100 hover:text-indigo-300 transition-colors truncate"
          >
            {name || '—'}
          </Link>
          {/* Urgency sits on the first line now. It was the last item on the
              row's third line, at the same size as "Source: Referral" — the
              least prominent thing in a row whose whole purpose is triage. */}
          {fu !== 'none' && c.followUpDate && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${FOLLOW_UP_PILL[fu]}`}>
              {fu === 'overdue' ? `Overdue · ${fmtDate(c.followUpDate)}`
                : fu === 'today' ? 'Due today'
                : `Follow-up ${fmtDate(c.followUpDate)}`}
            </span>
          )}
          <span className="text-xs text-gray-400 capitalize shrink-0">{c.category}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-gray-400">
          {c.phone && (
            <a href={`tel:${c.phone}`} className="hover:text-gray-100 transition-colors tabular-nums">
              {c.phone}
            </a>
          )}
          {meta.map(m => <span key={m} className="truncate">{m}</span>)}
        </div>
      </div>

      {c.amount > 0 && (
        <span className="text-sm font-semibold text-green-400 shrink-0 tabular-nums">{formatCurrency(c.amount)}</span>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {c.phone && (
          <a
            href={`tel:${c.phone}`}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-900/30 text-green-400 hover:bg-green-900/50 transition-colors"
            aria-label={`Call ${name}`}
            title="Call"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
            </svg>
          </a>
        )}
        {c.phone && (
          <a
            href={`sms:${c.phone}`}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 transition-colors"
            aria-label={`Text ${name}`}
            title="Text"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
            </svg>
          </a>
        )}
        {/* The queue had no way to finish anything: you could call, text or open
            the record, but nothing removed a row. Clearing the Called flag is
            the exact inverse of what put it here. */}
        <button
          type="button"
          onClick={() => onClear(c)}
          aria-label={`Clear callback for ${name}`}
          title="Mark handled — clears the Called flag"
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700/60 text-gray-400 hover:bg-gray-700 hover:text-gray-100 transition-colors"
        >
          <Icon d={ICONS.check} className="w-4 h-4" />
        </button>
        <Link
          to={`/records/${c.id}`}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700/60 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
          aria-label={`Open ${name}`}
          title="Open record"
        >
          <Icon d={ICONS.chevronRight} className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}
