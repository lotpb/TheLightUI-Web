import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { useSharedCustomers } from '../../hooks/useSharedCustomers'
import { useSharedInvoices, useSharedServicePlans } from '../../hooks/useSharedCollections'
import { categoryMatches, fullName } from '../../models/customer'
import {
  calculateHealthScore, healthBandRange, healthShortfalls, healthSummary,
  searchScored, sortScored,
  HEALTH_BANDS, HEALTH_MAX, HEALTH_SORTS,
  type HealthLabel, type HealthSort, type ScoredCustomer,
} from '../../utils/customerHealth'

type Filter = 'all' | HealthLabel

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CustomerHealthPage() {
  usePageTitle('Customer Health')

  /**
   * All three collections feed the score, so all three have to be in hand
   * before a number means anything.
   *
   * The page opened its own three listeners and cleared `loading` off the
   * customer one alone. Invoices and plans arrived afterwards, so the list
   * rendered once with `invoices = []` and `plans = []` — every customer
   * scoring 15/30 for "No invoices on file" and 0/20 for "No active service
   * plan" — and then every score and band label visibly jumped. The shared
   * hooks report loading, hitCap and failed per collection, and reuse the
   * listeners /customers already has open rather than adding three more.
   */
  const custSnap  = useSharedCustomers()
  const invSnap   = useSharedInvoices()
  const plansSnap = useSharedServicePlans()

  const customers = custSnap.items
  const invoices  = invSnap.items
  const plans     = plansSnap.items
  const loading   = custSnap.loading || invSnap.loading || plansSnap.loading

  /**
   * A collection that failed to load is not an empty collection.
   *
   * createSharedSubscription's own doc comment names this case: "a consumer
   * deriving a value from it (a health score from invoices) must not treat
   * missing data as absent data and publish a confident wrong answer." With
   * invoices missing, every customer banks 15 points for "No invoices on
   * file" instead of 0 for "Has overdue invoice(s)".
   */
  const unreliable = [
    invSnap.failed   && 'invoices',
    plansSnap.failed && 'service plans',
  ].filter(Boolean) as string[]

  const [filter, setFilter] = useState<Filter>('all')
  const [salesmanFilter, setSalesmanFilter] = useState('')
  const [sort, setSort]     = useState<HealthSort>('worst')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const scored = useMemo<ScoredCustomer[]>(
    () => customers
      .filter(c => categoryMatches(c.category, 'Customer') && c.isActive)
      .map(c => ({ customer: c, health: calculateHealthScore(c, invoices, plans) })),
    [customers, invoices, plans],
  )

  const salesmen = useMemo(() => {
    const set = new Set<string>()
    scored.forEach(s => { if (s.customer.salesman) set.add(s.customer.salesman) })
    return [...set].sort()
  }, [scored])

  /** Everything except the band filter — what the tiles describe. */
  const inScope = useMemo(
    () => searchScored(
      salesmanFilter ? scored.filter(s => s.customer.salesman === salesmanFilter) : scored,
      search,
    ),
    [scored, salesmanFilter, search],
  )

  /**
   * The tiles now count `inScope`, not every active customer. They used to sum
   * the whole book while the list below applied the rep filter as well, so
   * picking a rep left "At Risk 12" sitting above three rows.
   */
  const summary = useMemo(() => healthSummary(inScope), [inScope])

  const filtered = useMemo(
    () => sortScored(
      filter === 'all' ? inScope : inScope.filter(s => s.health.label === filter),
      sort,
    ),
    [inScope, filter, sort],
  )

  const scopeNarrowed = !!salesmanFilter || !!search.trim()

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white">Customer Health</h1>
        {/* Was text-gray-500 — 3.04:1. */}
        <p className="text-sm text-gray-300 mt-0.5">
          Account health across your active customer book, scored out of {HEALTH_MAX}.
        </p>
      </div>

      {/* A capped invoice list means the scorer can't see a customer's overdue
          invoice, so instead of 0 for "Has overdue invoice(s)" they bank 15
          for "No invoices on file" — a 15-point lift out of At Risk, in the
          flattering direction, with nothing previously saying so. */}
      {custSnap.hitCap && <PartialDataBanner totals />}
      {invSnap.hitCap && !custSnap.hitCap && (
        <PartialDataBanner
          totals
          detail="Invoices are capped, so a customer whose overdue invoice falls outside the cap scores as though they had none — every figure here is optimistic."
        />
      )}
      {plansSnap.hitCap && !custSnap.hitCap && !invSnap.hitCap && (
        <PartialDataBanner totals detail="Service plans are capped, so some customers score as though they had no plan." />
      )}

      {unreliable.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 bg-red-900/25 border border-red-700/50 rounded-xl px-4 py-3 text-red-200 text-sm mb-4"
        >
          <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Couldn’t load {unreliable.join(' or ')}, which {unreliable.length > 1 ? 'are' : 'is'} part of every score.
            The numbers below are missing {unreliable.length > 1 ? 'those factors' : 'that factor'} and read higher than they should — reload before acting on them.
          </span>
        </div>
      )}

      {loading ? (
        /* Was a single line of text-gray-500 "Loading…" at 3.04:1, while the
           rest of the app uses skeletons. */
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card h-20" />)}
          </div>
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card h-16" />)}
          </div>
        </div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
            {/* Not a filter tile: it's the average, and clicking it clears the
                band filter. Given its own shape so the one card that isn't a
                category doesn't look like one. */}
            <div className="card px-3 py-3 sm:col-span-1 flex flex-col justify-between">
              <div>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {summary.avg ?? '—'}
                </p>
                <p className="text-xs text-gray-300 mt-0.5">Avg score</p>
              </div>
              {filter !== 'all' && (
                <button
                  onClick={() => setFilter('all')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 text-left mt-1
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                >
                  Show all {summary.total.toLocaleString()}
                </button>
              )}
            </div>
            {/* Colours come from HEALTH_BANDS. The page kept its own colorMap
                and used text-cyan-400 for Good — the colour the band comment
                says this scale moved away from, and the only one of the four
                with no light-mode override (1.81:1 on a white card). */}
            {HEALTH_BANDS.map((band, i) => (
              <button
                key={band.label}
                onClick={() => setFilter(filter === band.label ? 'all' : band.label)}
                aria-pressed={filter === band.label}
                className={`card px-3 py-3 text-left transition-colors
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  filter === band.label
                    ? 'ring-2 ring-indigo-400 bg-indigo-500/15'
                    : 'hover:bg-gray-700/50'
                }`}
              >
                <p className={`text-2xl font-bold tabular-nums ${band.numberClass}`}>
                  {summary.counts[band.label]}
                </p>
                <p className="text-xs text-gray-300 mt-0.5">{band.label}</p>
                {/* healthBandRange exists for this and nothing rendered it, so
                    a row could read "Good 72" with the page never saying Good
                    spans 60–79. */}
                <p className="text-xs text-gray-400 tabular-nums">{healthBandRange(i)}</p>
              </button>
            ))}
          </div>

          <p className="text-xs text-gray-300 mb-4">
            Scored from recent contact (35), invoice health (30), an active service plan (20) and
            engagement (15). {scopeNarrowed && 'Counts above describe the filtered list below.'}
          </p>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[180px]">
              <Icon d={ICONS.search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name, email, phone…"
                aria-label="Search customers"
                className="input-field text-sm py-1.5 w-full pl-9"
              />
            </div>
            {salesmen.length > 0 && (
              <select
                value={salesmanFilter}
                onChange={e => setSalesmanFilter(e.target.value)}
                aria-label="Filter by sales rep"
                className="input-field text-sm py-1.5 pr-8"
              >
                <option value="">All sales reps</option>
                {salesmen.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {/* Order was fixed worst-first, with no way to see the healthiest
                accounts or to find one customer. */}
            <select
              value={sort}
              onChange={e => setSort(e.target.value as HealthSort)}
              aria-label="Sort order"
              className="input-field text-sm py-1.5 pr-8"
            >
              {HEALTH_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {(scopeNarrowed || filter !== 'all' || sort !== 'worst') && (
              <button
                onClick={() => { setSearch(''); setSalesmanFilter(''); setFilter('all'); setSort('worst') }}
                className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                Reset
              </button>
            )}
          </div>

          {/* List */}
          {filtered.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-gray-300">No customers match this filter.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(({ customer, health }) => {
                const open = openId === customer.id
                const gaps = healthShortfalls(health)
                return (
                  <div key={customer.id} className="card overflow-hidden">
                    <div className="px-4 py-3 flex items-center gap-3">
                      <div
                        className={`w-2 h-10 rounded-full shrink-0 ${health.barClass}`}
                        role="img"
                        aria-label={`${health.label} band`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            to={`/records/${customer.id}`}
                            className="font-medium text-gray-100 truncate hover:text-indigo-300 transition-colors
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                          >
                            {fullName(customer)}
                          </Link>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${health.badgeClass}`}>
                            {health.label}
                          </span>
                        </div>
                        {/* Was text-gray-500 at 3.04:1 — the only context each
                            row got. */}
                        <p className="text-xs text-gray-300 mt-0.5">
                          {customer.salesman && `${customer.salesman} · `}
                          Last updated {fmtDate(customer.lastUpdateDate)}
                        </p>
                      </div>
                      <p className="text-xl font-bold text-white shrink-0 tabular-nums">{health.score}</p>
                      {/* factors was computed for every row and discarded, so
                          a triage page said "At Risk · 35" and never why. */}
                      <button
                        onClick={() => setOpenId(open ? null : customer.id)}
                        aria-expanded={open}
                        aria-label={open ? `Hide score breakdown for ${fullName(customer)}` : `Why is ${fullName(customer)} ${health.label}?`}
                        className="shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700/60 transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        <Icon d={open ? ICONS.arrowUp : ICONS.arrowDown} className="w-4 h-4" />
                      </button>
                    </div>

                    {open && (
                      <div className="px-4 pb-3 pt-1 border-t border-gray-700 bg-gray-700/40">
                        <ul className="space-y-1.5 mt-2">
                          {health.factors.map(f => (
                            <li key={f.key} className="flex items-start gap-2 text-xs">
                              {/* emerald, not green-400: on this panel green-400
                                  resolves to #15803d in light mode and measures
                                  4.42:1 at 12px. emerald-400's override is
                                  #065f46, which clears 7:1 in both themes. */}
                              <span className={`shrink-0 tabular-nums font-semibold w-12 text-right ${
                                f.earned === f.max ? 'text-emerald-400'
                                  : f.earned === 0 ? 'text-red-400'
                                  : 'text-amber-400'
                              }`}>
                                {f.earned}/{f.max}
                              </span>
                              <span className="text-gray-100 font-medium w-28 shrink-0">{f.label}</span>
                              <span className="text-gray-300 flex-1">{f.detail}</span>
                            </li>
                          ))}
                        </ul>
                        {gaps.length > 0 && (
                          <p className="text-xs text-gray-300 mt-2.5 pt-2 border-t border-gray-700">
                            Biggest gap: <span className="text-gray-100 font-medium">{gaps[0].label}</span>
                            {' '}— worth {gaps[0].max - gaps[0].earned} point{gaps[0].max - gaps[0].earned !== 1 ? 's' : ''}.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
