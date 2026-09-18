import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  subscribeToAllActivities, loadOlderActivities, deleteActivity, ACTIVITY_PAGE_SIZE,
} from '../../services/activityService'
import { subscribeToCustomers } from '../../services/customerService'
import type { CustomerItem } from '../../models/customer'
import { ACTIVITY_TYPES, type Activity } from '../../models/activity'
import {
  buildFeedRows, filterFeed, fmtTimeOfDay, groupFeedByDay, searchedRows, timeAgo, typeCounts,
  type ActivityFilter, type FeedRow,
} from '../../models/activityFeed'
import { Icon, ICONS, ACTIVITY_ICONS } from '../../components/Icon'
import ConfirmModal from '../../components/ConfirmModal'
import PartialDataBanner from '../../components/PartialDataBanner'
import { useToast } from '../../components/Toast'
import { useAuthStore } from '../../stores/authStore'

export default function ActivityFeedPage() {
  usePageTitle('Activity Feed')
  const companyId = useAuthStore(s => s.companyId)
  const toast = useToast()

  const [activities, setActivities] = useState<Activity[]>([])
  const [older, setOlder]           = useState<Activity[]>([])
  const [customers, setCustomers]   = useState<CustomerItem[]>([])
  const [custCap, setCustCap]       = useState(false)
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState<ActivityFilter>('all')
  const [confirmDel, setConfirmDel] = useState<FeedRow | null>(null)

  const [cursor, setCursor]   = useState<QueryDocumentSnapshot<DocumentData> | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const olderCursor = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  useEffect(() => {
    let actDone = false, custDone = false
    const check = () => { if (actDone && custDone) setLoading(false) }
    /**
     * The feed is ordered by createdAt in the query now. It used to be
     * `limit(5000)` with no orderBy, so Firestore returned an arbitrary 5,000
     * documents in document-ID order that the page sorted client-side — a
     * random slice that merely looked chronological.
     */
    const unsubAct = subscribeToAllActivities(
      page => {
        setActivities(page.items)
        setCursor(page.cursor)
        setHasMore(page.hasMore)
        actDone = true; check()
      },
      () => { actDone = true; check() },
    )
    const unsubCust = subscribeToCustomers(
      (items, cap) => { setCustomers(items); setCustCap(!!cap); custDone = true; check() },
      () => { custDone = true; check() },
    )
    return () => { unsubAct(); unsubCust() }
  }, [companyId])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerItem>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  const rows = useMemo(
    () => buildFeedRows([...activities, ...older], customerMap),
    [activities, older, customerMap],
  )

  // Chip counts follow the search — they used to read from the unfiltered
  // list, so typing narrowed the feed while every chip kept its old number.
  const searched = useMemo(() => searchedRows(rows, search), [rows, search])
  const counts   = useMemo(() => typeCounts(searched), [searched])

  const visible = useMemo(() => filterFeed(rows, typeFilter, search), [rows, typeFilter, search])
  const groups  = useMemo(() => groupFeedByDay(visible), [visible])

  async function handleLoadOlder() {
    const from = olderCursor.current ?? cursor
    if (!from || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await loadOlderActivities(from)
      setOlder(prev => [...prev, ...page.items])
      olderCursor.current = page.cursor
      setHasMore(page.hasMore)
    } catch {
      toast('Couldn’t load older activity. Try again.', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleDelete(row: FeedRow) {
    setConfirmDel(null)
    try {
      await deleteActivity(row.id)
      setOlder(prev => prev.filter(a => a.id !== row.id))
      toast('Entry removed', 'success')
    } catch {
      toast('Couldn’t remove that entry. Try again.', 'error')
    }
  }

  const narrowed = search.trim().length > 0 || typeFilter !== 'all'

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Activity feed</h1>
          <p className="text-sm text-gray-300 mt-0.5">All interactions across every customer</p>
        </div>
        {!loading && (
          <div className="text-right shrink-0">
            <p className="text-xl font-bold text-white tabular-nums">
              {narrowed ? visible.length : rows.length}
            </p>
            {/* Was text-gray-500 on a label that says what the number means. */}
            <p className="text-xs text-gray-300">
              {narrowed ? `of ${rows.length} loaded` : 'entries loaded'}
            </p>
          </div>
        )}
      </div>

      {custCap && (
        <PartialDataBanner detail="Some customers fall outside the loaded set, so their activity shows without a name." />
      )}

      <div className="relative">
        <Icon d={ICONS.search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by customer, note, or rep…"
          aria-label="Search activity"
          className="input-field w-full text-sm py-2 pl-9"
        />
      </div>

      {/* Type filter chips */}
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filter by activity type">
        <button
          onClick={() => setTypeFilter('all')}
          aria-pressed={typeFilter === 'all'}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            typeFilter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'
          }`}
        >
          All ({searched.length})
        </button>
        {ACTIVITY_TYPES.map(t => {
          const count = counts[t.value] ?? 0
          if (count === 0) return null
          return (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              aria-pressed={typeFilter === t.value}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                typeFilter === t.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              <Icon d={ACTIVITY_ICONS[t.value]} className="w-3.5 h-3.5 shrink-0" />
              <span>{t.label} ({count})</span>
            </button>
          )
        })}
      </div>

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
      ) : visible.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <Icon d={ACTIVITY_ICONS.note} className="w-8 h-8 mx-auto text-gray-400" />
          <p className="text-gray-100 text-sm font-medium">
            {rows.length === 0 ? 'No activity logged yet' : 'Nothing matches'}
          </p>
          <p className="text-gray-300 text-sm">
            {rows.length === 0
              ? 'Open a customer record to add the first entry.'
              : 'Try a different search or clear the type filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Every day gets its own heading. dayLabel used to collapse
              anything older than a week into "September 2026". */}
          {groups.map(group => (
            <div key={group.key}>
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">
                {group.label}
                <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                  {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}
                </span>
              </p>
              <div className="relative">
                {/* Was bg-gray-800 on a bg-gray-950 page — 1.37:1, so the line
                    that makes a timeline read as a timeline was invisible. */}
                <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-700" aria-hidden="true" />
                <div className="space-y-0">
                  {group.items.map((row, idx) => (
                    <FeedRowView
                      key={row.id}
                      row={row}
                      isLast={idx === group.items.length - 1}
                      onDelete={setConfirmDel}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The feed was capped at an arbitrary 5,000 with no way to reach past it. */}
      {!loading && (hasMore || older.length > 0) && (
        <div className="text-center">
          {hasMore ? (
            <button
              onClick={handleLoadOlder}
              disabled={loadingMore}
              className="btn-secondary text-sm px-4 py-2 disabled:opacity-40
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {loadingMore ? 'Loading…' : `Load ${ACTIVITY_PAGE_SIZE} older entries`}
            </button>
          ) : (
            <p className="text-xs text-gray-300">That’s the whole history.</p>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmDel}
        confirmLabel="Remove entry"
        message={confirmDel
          ? `Remove this ${(confirmDel.typeLabel ?? 'activity').toLowerCase()} entry logged by ${confirmDel.userName || 'someone'}${confirmDel.customerName ? ` on ${confirmDel.customerName}` : ''}? This cannot be undone.`
          : ''}
        onConfirm={() => confirmDel && handleDelete(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  )
}

// ─── One feed row ────────────────────────────────────────────────────────────

function FeedRowView({ row, isLast, onDelete }: {
  row: FeedRow
  isLast: boolean
  onDelete: (row: FeedRow) => void
}) {
  return (
    <div className={`relative flex gap-3 group ${isLast ? 'pb-0' : 'pb-5'}`}>
      <div className="w-8 h-8 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center shrink-0 z-10">
        <Icon d={ACTIVITY_ICONS[row.type] ?? ACTIVITY_ICONS.note} className="w-4 h-4 text-gray-200" />
      </div>

      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          {/* A missing customer was rendered as the literal string "Unknown"
              and still linked to a record that may not exist. */}
          {row.customerMissing ? (
            <span className="text-sm font-semibold text-gray-300 italic" title="This customer record isn’t in the loaded set">
              Customer not found
            </span>
          ) : (
            <Link
              to={`/records/${row.customerId}`}
              className="text-sm font-semibold text-gray-100 hover:text-indigo-300 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
            >
              {row.customerName}
            </Link>
          )}
          {/* Was text-gray-500 / 600 / 700 — the type, who and when measured
              4.16, 2.66 and 1.95:1, and gray-700 has no light-mode rule at
              all (1.27:1 there). */}
          <span className="text-xs text-gray-300">{row.typeLabel ?? row.type}</span>
          <span className="text-xs text-gray-400" aria-hidden="true">·</span>
          <span className="text-xs text-gray-300">{row.userName || 'Unknown rep'}</span>
          <span
            className="text-xs text-gray-400 ml-auto shrink-0"
            title={row.createdAt.toLocaleString('en-US')}
          >
            {fmtTimeOfDay(row.createdAt)}
            <span className="sr-only"> — {timeAgo(row.createdAt)}</span>
          </span>
          <button
            onClick={() => onDelete(row)}
            aria-label={`Remove this ${(row.typeLabel ?? 'activity').toLowerCase()} entry`}
            className="shrink-0 p-1 -my-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700
                       transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Icon d={ICONS.trash} className="w-3.5 h-3.5" />
          </button>
        </div>
        {row.note && (
          <p className="text-sm text-gray-200 mt-0.5 whitespace-pre-wrap leading-relaxed break-words">
            {row.note}
          </p>
        )}
      </div>
    </div>
  )
}
