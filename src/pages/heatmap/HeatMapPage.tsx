import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { subscribeToCustomers } from '../../services/customerService'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useChartTheme } from '../../hooks/useChartTheme'
import { useIsLightMode } from '../../hooks/useIsLightMode'
import { buildHeatScale, type HeatBin } from '../../utils/heatScale'
import { compactCurrency, fullCurrency } from '../../utils/currency'
import type { CustomerItem } from '../../models/customer'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Grouping key. Case and stray whitespace shouldn't split a place in two. */
function norm(s: string) { return s.trim().toUpperCase() }

/**
 * How a place is written on screen.
 *
 * The grouping key is uppercased, and it used to be rendered raw — so the page
 * SHOUTED every value ("GARDEN CITY", "NEW YORK") under headers that are also
 * uppercase, leaving no case contrast anywhere. Two- and three-letter tokens
 * are state codes and stay as they are; anything longer is a name.
 */
function placeLabel(key: string): string {
  if (!key) return 'Unknown'
  if (key.length <= 3) return key
  return key.toLowerCase().replace(/\b[a-z]/g, ch => ch.toUpperCase())
}

function isLead(c: CustomerItem) { return norm(c.category) === 'LEAD' }
function isCustomer(c: CustomerItem) { return norm(c.category) === 'CUSTOMER' }

function revenue(c: CustomerItem) {
  return Number.isFinite(c.amount) ? c.amount : 0
}

interface Place {
  /** Uppercase, stable across spellings — also what the record links filter on. */
  key: string
  label: string
  total: number
  leads: number
  customers: number
  /** Vendors and employees. Part of `total`, so the bars have to account for it. */
  other: number
  revenue: number
  /** No state/city on the record at all. Not a quantity, so it can't be "top". */
  unknown: boolean
}

interface CityPlace extends Place {
  stateKey: string
  stateLabel: string
}

interface StatePlace extends Place {
  cities: CityPlace[]
}

type SortKey = 'label' | 'total' | 'leads' | 'customers' | 'revenue' | 'conv'
type View    = 'state' | 'city'
type Viz     = 'map' | 'chart'

function truncateLabel(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

/** Won out of decided: vendors and employees were never in the running. */
function convPct(p: Place): number {
  const decided = p.leads + p.customers
  return decided > 0 ? Math.round((p.customers / decided) * 100) : 0
}

const CHART_TOP   = 15
const TILE_LIMIT  = 60
const ROW_PREVIEW = 25

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HeatMapPage() {
  usePageTitle('Geographic Distribution')

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [hitCap, setHitCap]       = useState(false)

  const [catFilter,   setCatFilter]   = useState<'all' | 'lead' | 'customer'>('all')
  const [salesFilter, setSalesFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState<string | null>(null)
  const [view, setView]       = useState<View>('state')
  const [viz, setViz]         = useState<Viz>('map')
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [showAllRows, setShowAllRows] = useState(false)

  const chart = useChartTheme()
  const light = useIsLightMode()

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (list, cap) => { setCustomers(list); setHitCap(!!cap); setLoading(false) },
      ()          => setLoading(false),
    )
    return unsub
  }, [])

  const allReps = useMemo(() => {
    const s = new Set<string>()
    customers.forEach(c => { if (c.salesman) s.add(c.salesman) })
    return Array.from(s).sort()
  }, [customers])

  const filtered = useMemo(() => customers.filter(c => {
    if (catFilter === 'lead'     && !isLead(c))     return false
    if (catFilter === 'customer' && !isCustomer(c)) return false
    if (salesFilter !== 'all'    && c.salesman !== salesFilter) return false
    return true
  }), [customers, catFilter, salesFilter])

  const stateRows = useMemo(() => {
    const map = new Map<string, StatePlace>()
    for (const c of filtered) {
      const stKey = norm(c.state)
      let row = map.get(stKey)
      if (!row) {
        row = {
          key: stKey, label: placeLabel(stKey), unknown: stKey === '',
          total: 0, leads: 0, customers: 0, other: 0, revenue: 0, cities: [],
        }
        map.set(stKey, row)
      }
      const cityKey = norm(c.city)
      let cr = row.cities.find(x => x.key === cityKey)
      if (!cr) {
        cr = {
          key: cityKey, label: placeLabel(cityKey), unknown: cityKey === '',
          stateKey: stKey, stateLabel: row.label,
          total: 0, leads: 0, customers: 0, other: 0, revenue: 0,
        }
        row.cities.push(cr)
      }
      const lead = isLead(c), cust = isCustomer(c)
      for (const p of [row, cr] as Place[]) {
        p.total++
        if (lead) p.leads++
        else if (cust) p.customers++
        else p.other++
        p.revenue += revenue(c)
      }
    }
    return Array.from(map.values())
  }, [filtered])

  const cityRows = useMemo<CityPlace[]>(() => {
    const rows: CityPlace[] = []
    for (const sr of stateRows) {
      if (!stateFilter || sr.key === stateFilter) rows.push(...sr.cities)
    }
    return rows
  }, [stateRows, stateFilter])

  const rows: Place[] = view === 'state' ? stateRows : cityRows

  /**
   * By records, always — never by whatever the table is sorted on.
   *
   * These read from `sortedRows[0]` before, so clicking a column header far
   * down the page silently rewrote them: sort ascending and a card captioned
   * "Top State" showed the *smallest* state, still subtitled "N records". The
   * city card was worse — its memo didn't list the sort in its dependencies,
   * so it went stale rather than merely changing meaning.
   */
  const busiestState = useMemo(() => topByTotal(stateRows), [stateRows])
  const busiestCity  = useMemo(() => topByTotal(cityRows),  [cityRows])

  /** The ramp is rebuilt from whatever set is on screen, so the bands fit it. */
  const scale = useMemo(
    () => buildHeatScale(rows.filter(r => !r.unknown).map(r => r.total), light),
    [rows, light],
  )
  const binFor = (p: Place): HeatBin => p.unknown ? scale.neutral : scale.bins[scale.binOf(p.total)]

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      if (sortKey === 'label') return a.label.localeCompare(b.label) * dir
      const v = sortKey === 'conv'
        ? convPct(a) - convPct(b)
        : a[sortKey] - b[sortKey]
      return v * dir
    })
  }, [rows, sortKey, sortDir])

  /** Top N by records regardless of the table's sort — the title says so. */
  const chartData = useMemo(() => (
    [...rows]
      .sort((a, b) => b.total - a.total)
      .slice(0, CHART_TOP)
      .map(r => ({ name: r.label, Leads: r.leads, Customers: r.customers, Other: r.other }))
  ), [rows])

  const gridRows  = useMemo(() => [...rows].sort((a, b) => {
    if (a.unknown !== b.unknown) return a.unknown ? 1 : -1   // Unknown always last
    return b.total - a.total
  }), [rows])
  const shownTiles = gridRows.slice(0, TILE_LIMIT)

  const totalRecords = filtered.length
  const totalRevenue = filtered.reduce((s, c) => s + revenue(c), 0)
  const knownStates  = stateRows.filter(r => !r.unknown).length
  const knownCities  = useMemo(
    () => new Set(stateRows.flatMap(s => s.cities).filter(c => !c.unknown).map(c => `${c.key}|${c.stateKey}`)).size,
    [stateRows],
  )

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir(key === 'label' ? 'asc' : 'desc') }
  }

  function openState(key: string) {
    setStateFilter(key)
    setView('city')
    setShowAllRows(false)
  }

  function clearState() {
    setStateFilter(null)
    setView('state')
    setShowAllRows(false)
  }

  const stateLabel = stateFilter !== null
    ? (stateRows.find(s => s.key === stateFilter)?.label ?? placeLabel(stateFilter))
    : null

  if (loading) return <HeatMapSkeleton />

  const visibleRows = showAllRows ? sortedRows : sortedRows.slice(0, ROW_PREVIEW)

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Was nested inside the loading branch, where `hitCap` is false by
          definition — the same callback that sets it ends the load. It could
          never render. Every sibling analytics page puts it here. */}
      {hitCap && <PartialDataBanner totals />}

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Geographic Distribution</h1>
          <p className="text-sm text-gray-400 mt-0.5">Where your business is concentrated</p>
        </div>
        {stateFilter !== null && (
          <button
            onClick={clearState}
            className="flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300 rounded px-2 py-1
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon d={ICONS.chevronLeft} className="w-4 h-4" />
            All states
          </button>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <Segmented
          label="Category"
          value={catFilter}
          onChange={v => setCatFilter(v)}
          options={[
            { value: 'all' as const,      label: 'All' },
            { value: 'lead' as const,     label: 'Leads' },
            { value: 'customer' as const, label: 'Customers' },
          ]}
        />

        <label className="sr-only" htmlFor="heat-salesman">Salesperson</label>
        <select
          id="heat-salesman"
          value={salesFilter}
          onChange={e => setSalesFilter(e.target.value)}
          className="input-field text-sm py-1.5 pr-8 w-auto"
        >
          <option value="all">All salespeople</option>
          {allReps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <div className="ml-auto">
          <Segmented
            label="Group by"
            value={view}
            onChange={v => { setView(v); if (v === 'state') setStateFilter(null); setShowAllRows(false) }}
            options={[
              { value: 'state' as const, label: 'By state' },
              { value: 'city'  as const, label: 'By city' },
            ]}
          />
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Total records"
          value={totalRecords.toLocaleString()}
          sub={`${knownStates} state${knownStates === 1 ? '' : 's'} · ${knownCities.toLocaleString()} cities`}
        />
        <KpiCard
          label="Busiest state"
          value={busiestState?.label ?? '—'}
          sub={busiestState ? `${busiestState.total.toLocaleString()} records` : 'No state on any record'}
        />
        <KpiCard
          label="Busiest city"
          value={busiestCity?.label ?? '—'}
          sub={busiestCity ? `${busiestCity.total.toLocaleString()} records` : 'No city on any record'}
        />
        {/* Said "from customers" while summing every filtered record, leads
            included. It now names whatever the category filter is set to. */}
        <KpiCard
          label="Total revenue"
          value={compactCurrency(totalRevenue)}
          sub={catFilter === 'all' ? 'across all records' : `across ${catFilter}s only`}
        />
      </div>

      {/* ── Map / chart ──
          One card with two representations rather than two stacked cards.
          They answer the same question — which places are biggest — in two
          visual languages, and side by side they cost roughly a screen of
          scroll to say it twice. */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="card-section-title">
            {viz === 'map'
              ? (view === 'state' ? 'State heat map' : `City heat map${stateLabel ? ` — ${stateLabel}` : ''}`)
              : `Top ${Math.min(chartData.length, CHART_TOP)} by records`}
          </p>
          <Segmented
            label="Visualisation"
            value={viz}
            onChange={setViz}
            options={[
              { value: 'map'   as const, label: 'Map',   icon: ICONS.mapPin },
              { value: 'chart' as const, label: 'Chart', icon: ICONS.chartBar },
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <p className="text-gray-400 text-sm py-6 text-center">No records match the selected filters.</p>
        ) : viz === 'map' ? (
          <>
            <div className="flex flex-wrap gap-2">
              {shownTiles.map(p => (
                <HeatTile
                  key={view === 'state' ? p.key : `${(p as CityPlace).stateKey}|${p.key}`}
                  place={p}
                  bin={binFor(p)}
                  selected={view === 'state' && stateFilter === p.key}
                  onClick={view === 'state'
                    ? () => (stateFilter === p.key ? clearState() : openState(p.key))
                    : undefined}
                  to={view === 'city' && !p.unknown
                    ? recordsHref(catFilter, (p as CityPlace).stateKey, p.key)
                    : undefined}
                  wide={view === 'city'}
                  context={view === 'city' && !stateFilter ? (p as CityPlace).stateLabel : undefined}
                />
              ))}
            </div>
            {gridRows.length > shownTiles.length && (
              <p className="text-xs text-gray-400 mt-3">
                Showing the {TILE_LIMIT} busiest of {gridRows.length.toLocaleString()} — the rest are in the table below.
              </p>
            )}
            <HeatLegend legend={scale.legend} hasUnknown={gridRows.some(r => r.unknown)} neutral={scale.neutral} />
          </>
        ) : (
          <>
            {/* Every colour comes from the theme. The chart was still on the
                hexes chosen for the dark card, so in light mode the axis
                names sat at 1.47:1 on white and the tooltip was a dark box
                floating over a white page. */}
            <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 26)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} stroke={chart.axisLine} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: chart.label, fontSize: 11 }}
                  stroke={chart.axisLine}
                  width={view === 'state' ? 44 : 120}
                  /* Recharts clips an over-long tick against the axis width
                     rather than shortening it, so "Massapequa Park" lost its
                     last letters with nothing to say it had. The tooltip
                     still carries the full name. */
                  tickFormatter={(v: string) => truncateLabel(v, view === 'state' ? 5 : 18)}
                />
                <Tooltip {...chart.tooltip} />
                <Legend wrapperStyle={{ fontSize: 12, color: chart.label }} />
                {/* The bars used to stack leads and customers only, while
                    their colour encoded `total` — which includes vendors and
                    employees. A vendor-heavy state got a hot bar of near-zero
                    length. Length is the whole encoding now, and the three
                    segments add up to the total the table and the tiles show. */}
                <Bar dataKey="Leads"     stackId="a" fill={chart.accents[0]} />
                <Bar dataKey="Customers" stackId="a" fill={chart.accents[3]} />
                <Bar dataKey="Other"     stackId="a" fill={chart.axisLine} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-400 mt-2 text-center">
              Ordered by total records, independent of the table sort. &ldquo;Other&rdquo; is vendors and employees.
            </p>
          </>
        )}
      </div>

      {/* ── Table ── */}
      <div className="card overflow-hidden">
        {/* bg-gray-800/50 on a bg-gray-800 card is 1.000:1 — 50% of a colour
            over itself is that colour. gray-900 is a real step in both themes. */}
        <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-900">
          <p className="card-section-title">
            {view === 'state'
              ? `All states (${stateRows.length.toLocaleString()})`
              : `All cities${stateLabel ? ` in ${stateLabel}` : ''} (${cityRows.length.toLocaleString()})`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 bg-gray-900">
                <SortTh label={view === 'state' ? 'State' : 'City'} col="label" {...{ sortKey, sortDir, toggleSort }} />
                {view === 'city' && (
                  <th scope="col" className="text-left px-3 py-2.5 card-section-title">State</th>
                )}
                <SortTh label="Total"     col="total"     {...{ sortKey, sortDir, toggleSort }} />
                <SortTh label="Leads"     col="leads"     {...{ sortKey, sortDir, toggleSort }} />
                <SortTh label="Customers" col="customers" {...{ sortKey, sortDir, toggleSort }} />
                <SortTh label="Revenue"   col="revenue"   {...{ sortKey, sortDir, toggleSort }} />
                <SortTh label="Conv %"    col="conv"      {...{ sortKey, sortDir, toggleSort }}
                        title="Customers as a share of leads + customers" />
                <th scope="col" className="text-left px-4 py-2.5 card-section-title">Mix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {visibleRows.map(row => {
                const city = view === 'city' ? (row as CityPlace) : null
                const bin  = binFor(row)
                return (
                  <tr
                    key={city ? `${city.stateKey}|${row.key}` : row.key}
                    className="hover:bg-gray-700/40 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      {/* Was an onClick on the <tr>: not focusable, not
                          announced, and its only affordance was a gray-500
                          arrow at 3.04:1. */}
                      {view === 'state' && !row.unknown ? (
                        <button
                          type="button"
                          onClick={() => openState(row.key)}
                          className="flex items-center gap-1 font-semibold text-gray-100 hover:text-indigo-300 rounded
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <span
                            aria-hidden="true"
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: bin.bg, boxShadow: `inset 0 0 0 1px ${bin.ring}` }}
                          />
                          {row.label}
                          <Icon d={ICONS.chevronRight} className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 font-semibold text-gray-100">
                          <span
                            aria-hidden="true"
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: bin.bg, boxShadow: `inset 0 0 0 1px ${bin.ring}` }}
                          />
                          {row.label}
                        </span>
                      )}
                    </td>
                    {city && <td className="px-3 py-2.5 text-gray-400 text-xs">{city.stateLabel}</td>}
                    <td className="px-4 py-2.5 text-gray-200 font-medium tabular-nums">{row.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      <CountLink
                        n={row.leads}
                        to={row.unknown ? null : recordsHref('lead', city ? city.stateKey : row.key, city ? row.key : null)}
                        className="text-indigo-400 hover:text-indigo-300"
                        title={`View ${row.leads.toLocaleString()} leads in ${row.label}`}
                      />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      <CountLink
                        n={row.customers}
                        to={row.unknown ? null : recordsHref('customer', city ? city.stateKey : row.key, city ? row.key : null)}
                        className="text-green-400 hover:text-green-300"
                        title={`View ${row.customers.toLocaleString()} customers in ${row.label}`}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-gray-200 tabular-nums" title={fullCurrency(row.revenue)}>
                      {compactCurrency(row.revenue)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-300 tabular-nums">
                      {row.leads + row.customers > 0 ? `${convPct(row)}%` : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {/* Replaces a "Concentration" bar that was a third
                          rendering of `total` — already the column two to the
                          left and already the tile's colour. This shows the
                          one thing neither of those does. */}
                      <MixBar row={row} chartTheme={chart} />
                    </td>
                  </tr>
                )
              })}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={view === 'city' ? 8 : 7} className="px-4 py-8 text-center text-gray-400">
                    No records match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sortedRows.length > visibleRows.length && (
          <div className="px-4 py-3 border-t border-gray-700/50">
            <button
              onClick={() => setShowAllRows(true)}
              className="text-sm text-indigo-400 hover:text-indigo-300 rounded px-1
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Show all {sortedRows.length.toLocaleString()} rows
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Record links ─────────────────────────────────────────────────────────────

/**
 * The page had no way out of it.
 *
 * You could learn that New Jersey holds 240 records and there was nothing to
 * click to see them — no link to a list, and the city tiles weren't even
 * buttons. `state` is read by CustomerListPage as a filter and compared
 * case-insensitively, so the uppercase grouping key matches whatever casing
 * the records happen to carry. City rides on the existing `q` param, which
 * already searches the city field.
 */
function recordsHref(
  category: 'all' | 'lead' | 'customer',
  stateKey: string,
  cityKey: string | null,
): string {
  const base = category === 'lead' ? '/leads' : '/customers'
  const params = new URLSearchParams()
  if (stateKey) params.set('state', stateKey)
  if (cityKey)  params.set('q', cityKey)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

function CountLink({ n, to, className, title }: {
  n: number
  to: string | null
  className: string
  title: string
}) {
  if (n === 0 || !to) return <span className="text-gray-400">{n}</span>
  return <Link to={to} title={title} className={`${className} hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}>{n.toLocaleString()}</Link>
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: string | readonly string[] }[]
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
            value === o.value ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-700/40'
          }`}
        >
          {o.icon && <Icon d={o.icon} className="w-3.5 h-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function HeatTile({ place, bin, selected, onClick, to, wide, context }: {
  place: Place
  bin: HeatBin
  selected: boolean
  onClick?: () => void
  to?: string
  /** City names need room; state codes are two letters. */
  wide?: boolean
  /** Disambiguates the two Springfields when cities from every state are shown. */
  context?: string
}) {
  const style = {
    backgroundColor: bin.bg,
    color: bin.fg,
    boxShadow: `inset 0 0 0 1px ${bin.ring}`,
  }
  const label = `${place.label}${context ? `, ${context}` : ''}: ${place.total.toLocaleString()} record${place.total === 1 ? '' : 's'}`
  const cls = `relative flex flex-col items-center justify-center ${wide ? 'w-28' : 'w-16'} h-14 px-1.5 rounded-lg transition-transform
               focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500
               focus-visible:ring-offset-gray-800 ${
    onClick || to ? 'hover:scale-105' : ''
  } ${selected ? 'scale-105 ring-2 ring-indigo-400 ring-offset-2 ring-offset-gray-800' : ''}`

  const inner = (
    <>
      {/* Both lines take their colour from the band, measured against that
          band's background. `text-white` can't be used on an inline-styled
          background: it resolves to --color-white, which is dark navy in
          light mode, and no index.css rescue rule can reach an inline style. */}
      <span className="text-[11px] font-bold leading-tight text-center truncate max-w-full">{place.label}</span>
      <span className="text-[11px] font-medium leading-tight mt-0.5 tabular-nums">{place.total.toLocaleString()}</span>
    </>
  )

  if (to) return <Link to={to} title={label} aria-label={label} style={style} className={cls}>{inner}</Link>
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={selected} style={style} className={cls}>
        {inner}
      </button>
    )
  }
  return <div title={label} style={style} className={cls}>{inner}</div>
}

/**
 * The bands, with the counts they actually cover.
 *
 * The old legend was a "Fewer → More" gradient strip: it named no numbers, so
 * a colour could only be read by comparing it with other tiles, which is
 * precisely what the linear ramp made impossible.
 */
function HeatLegend({ legend, hasUnknown, neutral }: {
  legend: { bin: HeatBin; label: string }[]
  hasUnknown: boolean
  neutral: HeatBin
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 pt-3 border-t border-gray-700/50">
      <span className="text-xs text-gray-400">Records</span>
      {legend.map((l, i) => (
        <span key={i} className="flex items-center gap-1.5 text-xs text-gray-300">
          <span
            className="w-3.5 h-3.5 rounded-sm shrink-0"
            style={{ backgroundColor: l.bin.bg, boxShadow: `inset 0 0 0 1px ${l.bin.ring}` }}
          />
          {l.label}
        </span>
      ))}
      {hasUnknown && (
        <span className="flex items-center gap-1.5 text-xs text-gray-300">
          <span
            className="w-3.5 h-3.5 rounded-sm shrink-0"
            style={{ backgroundColor: neutral.bg, boxShadow: `inset 0 0 0 1px ${neutral.ring}` }}
          />
          No location on record
        </span>
      )}
    </div>
  )
}

function MixBar({ row, chartTheme }: { row: Place; chartTheme: ReturnType<typeof useChartTheme> }) {
  const total = row.total || 1
  const parts: { key: string; n: number; color: string }[] = [
    { key: 'Leads',     n: row.leads,     color: chartTheme.accents[0] },
    { key: 'Customers', n: row.customers, color: chartTheme.accents[3] },
    { key: 'Other',     n: row.other,     color: chartTheme.axisLine },
  ]
  const title = parts.filter(p => p.n > 0).map(p => `${p.n.toLocaleString()} ${p.key.toLowerCase()}`).join(' · ')
  return (
    <div className="flex h-2 w-24 min-w-[6rem] rounded-full overflow-hidden bg-gray-700" title={title} aria-label={title}>
      {parts.map(p => p.n > 0 && (
        <div key={p.key} style={{ width: `${(p.n / total) * 100}%`, backgroundColor: p.color }} />
      ))}
    </div>
  )
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  const sizeClass = value.length > 10 ? 'text-lg' : value.length > 6 ? 'text-xl' : 'text-2xl'
  return (
    <div className="card p-4">
      <p className="card-section-title">{label}</p>
      <p className={`${sizeClass} font-bold text-white mt-1 break-words leading-tight`}>{value}</p>
      {/* gray-500 is 3.04:1 on the card in dark mode. */}
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

function SortTh({ label, col, sortKey, sortDir, toggleSort, title }: {
  label: string
  col: SortKey
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  toggleSort: (k: SortKey) => void
  title?: string
}) {
  const active = sortKey === col
  return (
    <th
      scope="col"
      /* The header was a <th onClick> — no button, no tabIndex, no aria-sort,
         so the table couldn't be sorted from a keyboard at all. */
      aria-sort={active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
      className="text-left px-4 py-2.5 select-none"
    >
      <button
        type="button"
        onClick={() => toggleSort(col)}
        title={title}
        className="card-section-title flex items-center gap-1 hover:text-gray-200 rounded
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {label}
        {/* Was text-gray-700 — 1.42:1 in dark mode and 1.39:1 in light, so
            nothing indicated which columns were sortable. */}
        <Icon
          d={active && sortDir === 'asc' ? ICONS.arrowUp : ICONS.arrowDown}
          className={`w-3 h-3 shrink-0 ${active ? 'text-indigo-400' : 'text-gray-400 opacity-60'}`}
        />
      </button>
    </th>
  )
}

/**
 * Matches the loaded layout rather than replacing the page with one spinner,
 * so the filter bar, the cards and the table don't jump into place.
 */
function HeatMapSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-64 bg-gray-700 rounded" />
        <div className="h-4 w-48 bg-gray-700/60 rounded" />
      </div>
      <div className="card p-3 flex flex-wrap gap-3">
        <div className="h-9 w-56 bg-gray-700 rounded-lg" />
        <div className="h-9 w-44 bg-gray-700 rounded-lg" />
        <div className="h-9 w-44 bg-gray-700 rounded-lg ml-auto" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <div className="h-3 w-20 bg-gray-700/60 rounded" />
            <div className="h-7 w-24 bg-gray-700 rounded" />
            <div className="h-3 w-16 bg-gray-700/60 rounded" />
          </div>
        ))}
      </div>
      <div className="card p-4 space-y-3">
        <div className="h-3 w-32 bg-gray-700/60 rounded" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 18 }).map((_, i) => <div key={i} className="w-16 h-14 bg-gray-700 rounded-lg" />)}
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-900">
          <div className="h-3 w-28 bg-gray-700/60 rounded" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 h-[41px] flex items-center border-b border-gray-700/30">
            <div className="h-3.5 w-full max-w-md bg-gray-700/60 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Biggest by records, ignoring the "no location on record" bucket. */
function topByTotal<T extends Place>(rows: T[]): T | null {
  let best: T | null = null
  for (const r of rows) {
    if (r.unknown) continue
    if (!best || r.total > best.total) best = r
  }
  return best
}
