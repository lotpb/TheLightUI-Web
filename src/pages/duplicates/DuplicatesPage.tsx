import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToCustomers, mergeCustomers, countCustomerRelated } from '../../services/customerService'
import {
  subscribeToDismissals, dismissPair, restoreAllPairs, migrateLegacyDismissals,
} from '../../services/duplicateDismissalService'
import { fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import {
  computeMergePlan, countByReason, describeRelated, filterPairs, findDuplicates, totalRelated,
  DUPE_FILTERS, REASON_BADGE, REASON_LABEL,
  type DupePair, type DupeReason, type FilterMode, type RelatedCounts,
} from '../../models/duplicates'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/Toast'

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── One record panel ────────────────────────────────────────────────────────

function RecordCard({ customer: c, highlight, related }: {
  customer: CustomerItem
  highlight: DupeReason
  related?: RelatedCounts
}) {
  const name     = fullName(c)
  const initials = [c.first[0], c.lastname[0]].filter(Boolean).join('').toUpperCase()
  const nameHighlighted = highlight === 'name' || highlight === 'fuzzy-name'
  const attached = totalRelated(related)

  return (
    /* Was bg-gray-800/50 on a .card, which *is* bg-gray-800 — a percentage of
       a colour over itself is that colour, so on a page built entirely around
       comparing two panels, neither panel had any fill, edge or separation
       from the card or from each other. */
    <div className="flex-1 min-w-0 bg-gray-700/40 border border-gray-700 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-gray-600 flex items-center justify-center shrink-0 overflow-hidden">
          {c.photo ? (
            <img src={c.photo} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-semibold text-gray-100">{initials || '?'}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${nameHighlighted ? 'text-yellow-300' : 'text-gray-100'}`}>
            {name || '—'}
          </p>
          <p className="text-xs text-gray-300 capitalize">{c.category}</p>
        </div>
      </div>

      <div className="space-y-1 text-xs">
        {c.phone && (
          /* Was 📞 / ✉ / 👤 — platform bitmaps that ignore `color`, so they
             couldn't take the yellow highlight applied right beside them. */
          <p className={`flex items-center gap-1.5 truncate ${highlight === 'phone' ? 'text-yellow-300 font-medium' : 'text-gray-200'}`}>
            <Icon d={ICONS.phone} className="w-3 h-3 shrink-0" />
            <span className="truncate">{c.phone}</span>
          </p>
        )}
        {c.email && (
          <p className={`flex items-center gap-1.5 truncate ${highlight === 'email' ? 'text-yellow-300 font-medium' : 'text-gray-200'}`}>
            <Icon d={ICONS.envelope} className="w-3 h-3 shrink-0" />
            <span className="truncate">{c.email}</span>
          </p>
        )}
        {c.salesman && (
          <p className="flex items-center gap-1.5 text-gray-300 truncate">
            <Icon d={ICONS.user} className="w-3 h-3 shrink-0" />
            <span className="truncate">{c.salesman}</span>
          </p>
        )}
        {c.amount > 0 && <p className="text-green-400 font-medium">{formatCurrency(c.amount)}</p>}
        {/* Was text-gray-600 — 1.94:1 — on the one piece of evidence for
            deciding which record is the original. */}
        <p className="text-gray-400">Added {fmtDate(c.creationDate)}</p>
        {related && (
          <p className={attached > 0 ? 'text-gray-200 font-medium' : 'text-gray-400'}>
            {attached > 0
              ? `${attached} attached record${attached !== 1 ? 's' : ''}`
              : 'Nothing attached'}
          </p>
        )}
      </div>

      <Link
        to={`/records/${c.id}`}
        className="flex items-center justify-center gap-1 text-xs text-indigo-300 hover:text-indigo-200
                   bg-gray-600/60 hover:bg-gray-600 rounded-lg py-1.5 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        Open record
        <Icon d={ICONS.arrowRight} className="w-3 h-3" />
      </Link>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DuplicatesPage() {
  usePageTitle('Duplicates')
  const companyId = useAuthStore(s => s.companyId)
  const toast = useToast()

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hitCap, setHitCap]   = useState(false)
  const [filter, setFilter]   = useState<FilterMode>('all')
  const [mergeTarget, setMergeTarget] = useState<DupePair | null>(null)
  const [merging, setMerging] = useState(false)

  /**
   * Dismissals come from Firestore now, so the whole company shares one
   * verdict. They were per-browser localStorage, which meant two people
   * working the same queue saw different lists and clearing site data undid
   * every judgement.
   */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!companyId) return
    const unsub = subscribeToDismissals(setDismissed, () => {})
    // Anything this browser had stored locally moves up once, then the local
    // copy is cleared so it can't resurrect later.
    migrateLegacyDismissals()
      .then(n => { if (n > 0) toast(`Moved ${n} dismissed pair${n !== 1 ? 's' : ''} to your team's shared list.`, 'success') })
      .catch(() => {})
    return unsub
  }, [companyId])

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToCustomers(
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
      ()           => setLoading(false),
    )
    return unsub
  }, [companyId])

  const detection = useMemo(() => findDuplicates(all), [all])
  const pairs   = useMemo(() => filterPairs(detection.pairs, dismissed, filter), [detection.pairs, dismissed, filter])
  const counts  = useMemo(
    () => countByReason(detection.pairs.filter(p => !dismissed.has(p.key))),
    [detection.pairs, dismissed],
  )
  const dismissedCount = detection.pairs.filter(p => dismissed.has(p.key)).length

  async function handleDismiss(key: string) {
    try {
      await dismissPair(key)
    } catch {
      toast('Could not save that as "not a duplicate". Try again.', 'error')
    }
  }

  async function handleRestoreAll() {
    try {
      await restoreAllPairs()
      toast('Dismissed pairs restored', 'success')
    } catch {
      toast('Could not restore the dismissed pairs. Try again.', 'error')
    }
  }

  async function handleMerge(
    primaryId: string, secondaryId: string, updates: Record<string, unknown>, pairKey: string,
  ) {
    setMerging(true)
    try {
      const res = await mergeCustomers(primaryId, secondaryId, updates)
      if (res.incomplete) {
        // The server left the secondary active on purpose, so the pair stays
        // in the queue and running it again finishes the job.
        toast(
          `Moved ${res.totalMoved.toLocaleString()} records but didn't finish — the pair is still listed. Run the merge again.`,
          'error',
        )
      } else {
        setMergeTarget(null)
        await handleDismiss(pairKey)
        toast(
          res.totalMoved > 0
            ? `Merged. ${res.totalMoved.toLocaleString()} attached record${res.totalMoved !== 1 ? 's' : ''} moved to the surviving customer.`
            : 'Merged. The retired record had nothing attached.',
          'success',
        )
      }
    } catch (err) {
      toast(`Merge failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {hitCap && <PartialDataBanner totals />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Duplicate detector</h1>
          <p className="text-sm text-gray-300 mt-0.5">
            Exact phone, email and name matches, plus fuzzy name matches that catch typos.
            Merging moves everything attached to the retired record.
          </p>
        </div>
        {dismissedCount > 0 && (
          <button
            onClick={handleRestoreAll}
            className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1"
          >
            Restore {dismissedCount} dismissed
          </button>
        )}
      </div>

      {detection.fuzzyTruncated && (
        <div role="status" className="flex items-start gap-2 bg-amber-900/25 border border-amber-600/40 rounded-xl px-4 py-3 text-amber-200 text-sm">
          <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Fuzzy name matching stopped early on {detection.scanned.toLocaleString()} records — exact phone,
            email and name matches below are complete, but some similar-name pairs may be missing.
          </span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by match type">
        {DUPE_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              filter === f.id
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'
            }`}
          >
            {f.label} ({counts[f.id]})
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="card h-40 animate-pulse" />)}
        </div>
      ) : pairs.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <Icon d={ICONS.checkCircle} className="w-10 h-10 text-gray-400 mx-auto" />
          <p className="text-gray-100 text-sm font-medium">No duplicates found</p>
          <p className="text-gray-300 text-xs">
            {dismissedCount > 0
              ? `${dismissedCount} pair${dismissedCount !== 1 ? 's' : ''} dismissed as not duplicates.`
              : `All ${detection.scanned.toLocaleString()} active records look clean.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pairs.map(pair => (
            <div key={pair.key} className="card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-gray-700/50 border-b border-gray-700">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${REASON_BADGE[pair.reason]}`}>
                    {REASON_LABEL[pair.reason]}
                  </span>
                  {/* Was text-gray-500 — 3.04:1 — on the value that justifies
                      the pair being shown at all. */}
                  <span className="text-xs text-gray-200 truncate">
                    {pair.reason === 'fuzzy-name' && pair.similarity !== undefined
                      ? `${Math.round(pair.similarity * 100)}% similar`
                      : pair.matchValue}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setMergeTarget(pair)}
                    className="text-xs text-indigo-300 hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-gray-600/60
                               transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    Merge
                  </button>
                  {/* Was text-gray-600 at 1.94:1 — one of the two primary
                      actions, beside a bright indigo sibling. */}
                  <button
                    onClick={() => handleDismiss(pair.key)}
                    className="text-xs text-gray-200 hover:text-white px-2 py-1 rounded-lg hover:bg-gray-600/60
                               transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    Not a duplicate
                  </button>
                </div>
              </div>

              <div className="flex gap-2 p-3 items-stretch">
                <RecordCard customer={pair.a} highlight={pair.reason} />
                <div className="flex items-center justify-center shrink-0">
                  <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center">
                    <Icon d={ICONS.refresh} className="w-3 h-3 text-gray-100" />
                  </div>
                </div>
                <RecordCard customer={pair.b} highlight={pair.reason} />
              </div>
            </div>
          ))}
        </div>
      )}

      {mergeTarget && (
        <MergeModal
          pair={mergeTarget}
          working={merging}
          onMerge={handleMerge}
          onClose={() => setMergeTarget(null)}
        />
      )}
    </div>
  )
}

// ─── Merge modal ─────────────────────────────────────────────────────────────

function MergeModal({ pair, working, onMerge, onClose }: {
  pair: DupePair
  working: boolean
  onMerge: (primaryId: string, secondaryId: string, updates: Record<string, unknown>, key: string) => void
  onClose: () => void
}) {
  const [primaryIsA, setPrimaryIsA] = useState(true)
  const [related, setRelated] = useState<Record<string, RelatedCounts> | null>(null)
  const [countsFailed, setCountsFailed] = useState(false)

  const primary   = primaryIsA ? pair.a : pair.b
  const secondary = primaryIsA ? pair.b : pair.a
  const { updates, changes, discarded } = computeMergePlan(primary, secondary)

  /**
   * A merge moves every attached document, which makes "how much is attached
   * to each side" the most important input to "which one do we keep" — and it
   * wasn't on screen at all.
   */
  useEffect(() => {
    let live = true
    countCustomerRelated([pair.a.id, pair.b.id])
      .then(c => { if (live) setRelated(c) })
      .catch(() => { if (live) setCountsFailed(true) })
    return () => { live = false }
  }, [pair.a.id, pair.b.id])

  const movingCount = totalRelated(related?.[secondary.id])
  const movingDetail = describeRelated(related?.[secondary.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 shrink-0">
          <h2 id="merge-title" className="text-base font-semibold text-white">Merge records</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 -mr-1 rounded text-gray-300 hover:text-white hover:bg-gray-700/60 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Icon d={ICONS.close} className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-5">
          {/* Primary selector */}
          <div>
            <p className="text-xs text-gray-300 mb-2 font-medium uppercase tracking-wider">
              Keep as primary (the record that survives)
            </p>
            <div className="flex gap-2">
              {([{ isA: true, c: pair.a }, { isA: false, c: pair.b }]).map(({ isA, c }) => {
                const selected = primaryIsA === isA
                const attached = totalRelated(related?.[c.id])
                return (
                  <button
                    key={c.id}
                    onClick={() => setPrimaryIsA(isA)}
                    aria-pressed={selected}
                    className={`flex-1 text-left p-3 rounded-xl border transition-colors
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                      selected
                        ? 'border-indigo-400 bg-indigo-500/20'
                        : 'border-gray-600 bg-gray-700/40 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${selected ? 'border-indigo-400' : 'border-gray-400'}`}>
                        {selected && <div className="w-1.5 h-1.5 rounded-full bg-indigo-300" />}
                      </div>
                      <span className="text-sm font-semibold text-gray-100 truncate">{fullName(c) || '—'}</span>
                    </div>
                    {c.phone && <p className="text-xs text-gray-200 ml-5 truncate">{c.phone}</p>}
                    {c.email && <p className="text-xs text-gray-200 ml-5 truncate">{c.email}</p>}
                    <p className="text-xs text-gray-400 ml-5 mt-0.5">Added {fmtDate(c.creationDate)}</p>
                    <p className={`text-xs ml-5 ${attached > 0 ? 'text-gray-100 font-medium' : 'text-gray-400'}`}>
                      {related === null && !countsFailed
                        ? 'Counting attached records…'
                        : countsFailed
                          ? 'Attached records unknown'
                          : attached > 0
                            ? `${attached} attached record${attached !== 1 ? 's' : ''}`
                            : 'Nothing attached'}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* What moves */}
          <div>
            <p className="text-xs text-gray-300 mb-2 font-medium uppercase tracking-wider">What moves across</p>
            <div className="bg-gray-700/40 border border-gray-700 rounded-xl p-3 space-y-2">
              {countsFailed ? (
                <p className="text-sm text-amber-200 flex items-start gap-2">
                  <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
                  Couldn’t count what’s attached to these records. The merge will still move everything,
                  but you can’t see the total first.
                </p>
              ) : related === null ? (
                <p className="text-sm text-gray-300">Counting…</p>
              ) : movingCount === 0 ? (
                <p className="text-sm text-gray-200">
                  Nothing is attached to {fullName(secondary) || 'the retired record'} — only its field values move.
                </p>
              ) : (
                <>
                  <p className="text-sm text-gray-100">
                    <span className="font-semibold">{movingCount.toLocaleString()}</span> record
                    {movingCount !== 1 ? 's' : ''} will be reassigned to {fullName(primary) || 'the primary'}:
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {movingDetail.map(d => (
                      <li key={d.label} className="text-xs bg-gray-600/60 text-gray-100 rounded-full px-2 py-0.5 tabular-nums">
                        {d.count} {d.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Field changes */}
          <div>
            <p className="text-xs text-gray-300 mb-2 font-medium uppercase tracking-wider">
              {changes.length === 0 ? 'No fields to fill' : `${changes.length} field${changes.length !== 1 ? 's' : ''} filled in`}
            </p>
            {changes.length === 0 ? (
              <p className="text-sm text-gray-200 bg-gray-700/40 border border-gray-700 rounded-xl p-3">
                The primary already has a value for everything the secondary provides.
              </p>
            ) : (
              <div className="bg-gray-700/40 border border-gray-700 rounded-xl divide-y divide-gray-700">
                {changes.map(c => (
                  <div key={c.firestoreKey} className="flex items-start gap-3 px-3 py-2.5">
                    {/* The /50 tints these used had no light-mode rule, unlike
                        the /40 and /30 variants of the same hues, so they
                        rendered as dark chips inside a white modal. */}
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                      c.action === 'combine'
                        ? 'bg-violet-900/40 text-violet-400'
                        : 'bg-sky-900/40 text-sky-400'
                    }`}>
                      {c.action}
                    </span>
                    <div className="min-w-0">
                      <span className="text-sm text-gray-100 font-medium">{c.label}</span>
                      <p className="text-xs text-gray-300 truncate mt-0.5">{c.from}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* What gets dropped — the dialog never showed this side */}
          {discarded.length > 0 && (
            <div>
              <p className="text-xs text-gray-300 mb-2 font-medium uppercase tracking-wider">
                {discarded.length} value{discarded.length !== 1 ? 's' : ''} discarded
              </p>
              <div className="bg-gray-700/40 border border-gray-700 rounded-xl divide-y divide-gray-700">
                {discarded.map(d => (
                  <div key={d.label} className="px-3 py-2 text-xs">
                    <span className="text-gray-100 font-medium">{d.label}</span>
                    <p className="text-gray-300 mt-0.5 truncate">
                      keeping <span className="text-gray-100">{d.keeping}</span>
                      {' · '}
                      losing <span className="text-red-300 line-through">{d.losing}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 bg-amber-900/25 border border-amber-600/40 rounded-xl px-3 py-2.5 text-xs text-amber-200">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {fullName(secondary) || 'The secondary record'} will be deactivated and hidden from active
              lists, with everything attached to it reassigned to {fullName(primary) || 'the primary'}.
              This cannot be undone automatically.
            </span>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-700 shrink-0">
          <button
            onClick={onClose}
            disabled={working}
            className="flex-1 py-2 rounded-xl border border-gray-600 text-sm text-gray-200 hover:text-white
                       hover:border-gray-500 transition-colors disabled:opacity-40
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Cancel
          </button>
          <button
            onClick={() => onMerge(primary.id, secondary.id, updates, pair.key)}
            disabled={working}
            className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500
                       transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            {working
              ? 'Merging…'
              : movingCount > 0 ? `Merge and move ${movingCount.toLocaleString()}` : 'Confirm merge'}
          </button>
        </div>
      </div>
    </div>
  )
}
