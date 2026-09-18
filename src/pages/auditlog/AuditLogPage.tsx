import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { usePageTitle } from '../../hooks/usePageTitle'
import { Icon, ICONS } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import {
  subscribeToAuditLog, loadOlderAuditEntries, AUDIT_PAGE_SIZE,
} from '../../services/auditLogService'
import {
  actorOf, displayValue, fieldLabel, fmtAuditTime, groupByDay, isTruncated,
  recordPath, searchAuditEntries,
  ACTION_COLORS, ACTION_LABELS, AUDIT_FILTERS,
  type AuditFilter, type AuditLogEntry,
} from '../../models/auditLog'

export default function AuditLogPage() {
  usePageTitle('Audit Log')
  const toast = useToast()

  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<AuditFilter>('all')
  const [search, setSearch]   = useState('')

  /** Cursor for the next older page, and whether one exists. */
  const [cursor, setCursor]   = useState<QueryDocumentSnapshot<DocumentData> | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  /** Pages fetched beyond the live one, kept separate so the listener can
   *  replace the newest page without discarding history already loaded. */
  const [older, setOlder] = useState<AuditLogEntry[]>([])
  const olderCursor = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  /**
   * The filter goes into the query now.
   *
   * It used to fetch the 200 most recent entries company-wide and filter them
   * in the browser, so "Proposals" showed whichever proposal rows happened to
   * fall inside that window — one bulk operation across a few hundred
   * customers filled it entirely and the other tabs went empty while their
   * history sat untouched in Firestore.
   */
  useEffect(() => {
    setLoading(true)
    setOlder([])
    olderCursor.current = null
    const unsub = subscribeToAuditLog(
      filter,
      page => {
        setEntries(page.entries)
        setCursor(page.cursor)
        setHasMore(page.hasMore)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [filter])

  async function handleLoadOlder() {
    const from = olderCursor.current ?? cursor
    if (!from || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await loadOlderAuditEntries(filter, from)
      setOlder(prev => [...prev, ...page.entries])
      olderCursor.current = page.cursor
      setHasMore(page.hasMore)
    } catch {
      toast('Couldn’t load older entries. Try again.', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  const all = useMemo(() => [...entries, ...older], [entries, older])
  const visible = useMemo(() => searchAuditEntries(all, search), [all, search])
  const groups  = useMemo(() => groupByDay(visible), [visible])

  const searching = search.trim().length > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white">Audit log</h1>
        {/* Was text-gray-500 — 3.04:1. */}
        <p className="text-sm text-gray-300 mt-0.5">
          Who changed what on customer, invoice and proposal records.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex gap-1 bg-gray-800 p-1 rounded-xl" role="group" aria-label="Filter by record type">
          {AUDIT_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              // The tabs carried no pressed state, so a screen reader got four
              // buttons with no indication which was active.
              aria-pressed={filter === f.key}
              className={`text-sm px-4 py-1.5 rounded-lg font-medium transition-colors
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                filter === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* The two questions an audit log exists to answer — "what did this
            person change" and "who touched this record" — both meant scrolling
            and reading every row. */}
        <div className="relative flex-1 min-w-[200px]">
          <Icon d={ICONS.search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search person, record, field or value…"
            aria-label="Search the audit log"
            className="input-field text-sm py-1.5 w-full pl-9"
          />
        </div>
      </div>

      {searching && (
        <p className="text-xs text-gray-300 mb-3">
          {visible.length} of {all.length} loaded {all.length === 1 ? 'entry' : 'entries'} match “{search.trim()}”.
          {hasMore && ' Load older entries below to search further back.'}
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="card h-24 animate-pulse" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="card p-8 text-center">
          <Icon d={ICONS.clipboard} className="w-9 h-9 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-100 font-medium">
            {searching ? 'Nothing matches that search' : 'No changes recorded yet'}
          </p>
          <p className="text-sm text-gray-300 mt-1">
            {searching
              ? 'Try a person’s name, a record name, or a field.'
              : 'Edits to customers, invoices and proposals will show up here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Every row used to carry a full absolute datestamp, so a burst of
              activity read as N unrelated events. */}
          {groups.map(group => (
            <div key={group.key}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300 mb-2 px-1">
                {group.label}
                <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                  {group.entries.length} {group.entries.length === 1 ? 'change' : 'changes'}
                </span>
              </h2>
              <div className="space-y-2">
                {group.entries.map(entry => <EntryCard key={entry.id} entry={entry} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The feed was hard-capped at 200 with no pagination and no notice, so
          everything older was unreachable through the UI. */}
      {!loading && (hasMore || older.length > 0) && (
        <div className="mt-5 text-center">
          {hasMore ? (
            <button
              onClick={handleLoadOlder}
              disabled={loadingMore}
              className="btn-secondary text-sm px-4 py-2 disabled:opacity-40
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {loadingMore ? 'Loading…' : `Load ${AUDIT_PAGE_SIZE} older entries`}
            </button>
          ) : (
            <p className="text-xs text-gray-300">That’s the whole history for this filter.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── One entry ────────────────────────────────────────────────────────────────

function EntryCard({ entry }: { entry: AuditLogEntry }) {
  const link  = recordPath(entry)
  const actor = actorOf(entry.changedBy)

  return (
    <div className="card p-4">
      <div className="flex items-start gap-2 flex-wrap">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${ACTION_COLORS[entry.action]}`}>
          {ACTION_LABELS[entry.action]}
        </span>
        {/* Was bg-gray-800 on a .card that *is* bg-gray-800 — exactly 1.000:1,
            so this chip had no fill beside a properly filled action badge. */}
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 capitalize shrink-0">
          {entry.entityType}
        </span>
        {link ? (
          <Link
            to={link}
            className="font-medium text-indigo-300 hover:text-indigo-200 truncate
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
          >
            {entry.entityLabel || entry.entityId}
          </Link>
        ) : (
          <span className="font-medium text-gray-100 truncate">
            {entry.entityLabel || entry.entityId}
          </span>
        )}
      </div>

      <p className="text-xs mt-1.5 flex items-center gap-1.5 flex-wrap">
        {/* "Unknown" was rendered as though it were somebody's name. */}
        <span className={actor.unattributed ? 'text-gray-400 italic' : 'text-gray-200 font-medium'}>
          {actor.label}
        </span>
        {actor.automated && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200">
            automated
          </span>
        )}
        <span className="text-gray-400">· {fmtAuditTime(entry.createdAt)}</span>
      </p>

      {actor.unattributed && (
        <p className="text-xs text-gray-400 mt-1">
          This change came from a path that doesn’t record who made it.
        </p>
      )}

      {entry.changes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {entry.changes.map((c, i) => (
            <li key={`${c.field}-${i}`} className="text-xs">
              <span className="text-gray-100 font-medium">{fieldLabel(c.field)}</span>
              {': '}
              {/* The "before" half was text-gray-500 at 3.04:1 against a
                  "after" at 11.86:1 — a change is a pair, and the thing you
                  compare against was four times less legible. */}
              <span className="text-gray-300 line-through decoration-gray-500 break-words">
                {displayValue(c.from)}
              </span>
              <span className="text-gray-400 mx-1">→</span>
              <span className="text-gray-100 break-words">{displayValue(c.to)}</span>
              {(isTruncated(c.from) || isTruncated(c.to)) && (
                /* Values are clipped server-side; this used to be silent, so a
                   JSON fragment read as the whole value. */
                <span className="text-gray-400 ml-1">(shortened)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
