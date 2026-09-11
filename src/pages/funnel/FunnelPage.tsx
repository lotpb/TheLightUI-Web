import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from 'recharts'

import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useChartTheme } from '../../hooks/useChartTheme'
import { subscribeToCustomers } from '../../services/customerService'
import { useAuthStore } from '../../stores/authStore'
import { compactCurrency, fullCurrency } from '../../utils/currency'
import {
  funnelCounts, buildFunnel, groupFunnel, monthlyCounts, rate, type GroupRow,
} from '../../utils/funnel'
import { type CustomerItem } from '../../models/customer'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Period = 'all' | 'year' | '6m' | '3m' | 'month'

const PERIODS: { key: Period; label: string; phrase: string }[] = [
  { key: 'all',   label: 'All time',   phrase: 'all time' },
  { key: 'year',  label: 'This year',  phrase: 'this year' },
  { key: '6m',    label: '6 months',   phrase: 'the last 6 months' },
  { key: '3m',    label: '3 months',   phrase: 'the last 3 months' },
  { key: 'month', label: 'This month', phrase: 'this month' },
]

function periodStart(p: Period): Date | null {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (p === 'month') { d.setDate(1); return d }
  if (p === '3m')    { d.setMonth(d.getMonth() - 3); return d }
  if (p === '6m')    { d.setMonth(d.getMonth() - 6); return d }
  if (p === 'year')  { d.setMonth(0, 1); return d }
  return null
}

/** A rate, or an em dash when there was nothing to divide by. */
function pctLabel(v: number | null): string {
  return v === null ? '—' : `${v}%`
}

function rateColor(v: number | null, good: number, ok: number): string {
  if (v === null) return 'text-gray-400'
  return v >= good ? 'text-green-400' : v >= ok ? 'text-yellow-400' : 'text-red-400'
}

const TREND_MONTHS = 12
const SOURCE_LIMIT = 10

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FunnelPage() {
  usePageTitle('Lead Funnel')
  const companyId = useAuthStore(s => s.companyId)
  const chart = useChartTheme()

  const [all, setAll]         = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hitCap, setHitCap]   = useState(false)
  const [period, setPeriod]   = useState<Period>('all')
  const [repFilter, setRepFilter] = useState('')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (items, cap) => { setAll(items); setHitCap(!!cap); setLoading(false) },
      ()           => setLoading(false),
    )
    return unsub
  }, [companyId])

  const reps = useMemo(() => {
    const s = new Set<string>()
    for (const c of all) if (c.salesman) s.add(c.salesman)
    return [...s].sort()
  }, [all])

  /** Rep filter only — the trend chart needs history the period would cut. */
  const repScoped = useMemo(
    () => (repFilter ? all.filter(c => c.salesman === repFilter) : all),
    [all, repFilter],
  )

  /**
   * The cohort: lead-and-customer records created in the window.
   *
   * A funnel is a cohort walking through stages, so the window has to pick
   * the cohort and then follow it — which is what creationDate does. It means
   * the revenue line is revenue from records *created* in the window, and the
   * page now says so rather than calling it "revenue from customers".
   */
  const cohort = useMemo(() => {
    const start = periodStart(period)
    return start ? repScoped.filter(c => c.creationDate >= start) : repScoped
  }, [repScoped, period])

  const counts = useMemo(() => funnelCounts(cohort), [cohort])
  const stages = useMemo(() => buildFunnel(counts), [counts])

  const winRate     = rate(counts.won, counts.cohort)
  const contactRate = rate(counts.contacted, counts.cohort)
  const avgDeal     = counts.won > 0 ? counts.revenue / counts.won : 0

  const trend = useMemo(
    () => monthlyCounts(repScoped, TREND_MONTHS),
    [repScoped],
  )

  const byRep = useMemo(() => (
    groupFunnel(cohort, c => c.salesman.trim() || 'Unassigned')
      .sort((a, b) => b.revenue - a.revenue || b.cohort - a.cohort)
  ), [cohort])

  const bySource = useMemo(() => {
    const rows = groupFunnel(cohort, c => c.leadSource?.trim() || 'No source recorded')
    // "No source recorded" isn't a source, so it can't win the ranking — it
    // sits at the end where it reads as the gap in the data that it is.
    const named   = rows.filter(r => r.name !== 'No source recorded').sort((a, b) => b.cohort - a.cohort)
    const unknown = rows.filter(r => r.name === 'No source recorded')
    return [...named.slice(0, SOURCE_LIMIT), ...unknown]
  }, [cohort])

  const maxSource = Math.max(...bySource.map(s => s.cohort), 1)
  const periodPhrase = PERIODS.find(p => p.key === period)!.phrase
  const isEmpty = counts.cohort === 0

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {hitCap && <PartialDataBanner totals />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Lead Funnel</h1>
          {/* Every figure is scoped to the records created in the window, and
              nothing said which window or which date it keys on. */}
          <p className="text-sm text-gray-400 mt-0.5">
            Leads and customers created {periodPhrase}, from first contact to completed job
            {repFilter && <> · {repFilter}</>}
          </p>
        </div>
        <div className="shrink-0">
          <label htmlFor="funnel-rep" className="sr-only">Salesperson</label>
          <select
            id="funnel-rep"
            value={repFilter}
            onChange={e => setRepFilter(e.target.value)}
            className="input-field text-sm py-1.5 w-40"
          >
            <option value="">All reps</option>
            {reps.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div role="group" aria-label="Created in" className="flex gap-1.5 flex-wrap">
        {PERIODS.map(p => (
          <button
            key={p.key}
            type="button"
            aria-pressed={period === p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              period === p.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-100 hover:bg-gray-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <FunnelSkeleton />
      ) : isEmpty ? (
        /* Rendered *instead of* the page, not below it. It used to be a
           sibling, so an empty period showed four zero KPIs, a funnel of five
           floored bars each reading 0, an empty chart — and then the notice
           that there was nothing to show. */
        <div className="card p-12 text-center space-y-3">
          <Icon d={ICONS.chartBar} className="w-8 h-8 mx-auto text-gray-400" />
          <p className="text-gray-300 text-sm">
            No leads or customers were created {periodPhrase}
            {repFilter && <> by {repFilter}</>}.
          </p>
          <Link to="/leads" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">
            View leads →
          </Link>
        </div>
      ) : (
        <>
          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="In cohort"    value={counts.cohort.toLocaleString()} color="text-indigo-400"
                 sub={`${counts.won.toLocaleString()} won`} />
            <Kpi label="Contact rate" value={pctLabel(contactRate)} color={rateColor(contactRate, 60, 40)}
                 sub="reached at least once" />
            <Kpi label="Win rate"     value={pctLabel(winRate)}     color={rateColor(winRate, 30, 15)}
                 sub="of everything created" />
            <Kpi label="Avg deal"     value={counts.won > 0 ? compactCurrency(avgDeal) : '—'} color="text-green-400"
                 title={counts.won > 0 ? fullCurrency(avgDeal) : undefined}
                 sub={counts.won > 0 ? 'per won deal' : 'nothing won yet'} />
          </div>

          {/* ── Funnel ── */}
          <section className="card overflow-hidden">
            {/* bg-gray-800/50 on a bg-gray-800 card is 1.000:1 in both themes. */}
            <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-900">
              <p className="card-section-title">Conversion funnel</p>
            </div>
            <div className="p-4 sm:p-6 space-y-1">
              {stages.map((stage, i) => (
                <div key={stage.key}>
                  {i > 0 && (
                    /* Was text-gray-600 at 1.94:1 — the single number a
                       funnel exists to show, set fainter than anything else. */
                    <p className="text-xs text-gray-400 text-center py-1">
                      {stage.fromPrevious}% of {stages[i - 1].label.toLowerCase()} continued
                    </p>
                  )}
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-20 sm:w-28 shrink-0 text-right">
                      <span className="text-xs font-medium text-gray-300" title={stage.hint}>{stage.label}</span>
                    </div>
                    {/* Track was bg-gray-800 on a bg-gray-800 card, so the
                        unfilled part of every bar was the card itself. */}
                    <div className="flex-1 bg-gray-700 rounded-full h-7 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        /* No Math.max floor: a stage with nothing in it now
                           renders nothing, instead of a 12% bar reading 0.
                           And ofCohort can't exceed 100, so nothing is
                           clipped by overflow-hidden either. */
                        style={{ width: `${stage.ofCohort}%`, background: chart.accents[i % chart.accents.length] }}
                      />
                    </div>
                    {/* Counts sit outside the bar in themed text. In the bar
                        they were text-white over an inline background — which
                        no light-mode rule can reach, and which measured
                        2.15:1 on the amber stage in dark mode. */}
                    <span className="w-12 shrink-0 text-right text-sm font-semibold text-gray-100 tabular-nums">
                      {stage.count.toLocaleString()}
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs text-gray-400 tabular-nums">
                      {stage.ofCohort}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 sm:px-6 pb-4 pt-3 flex items-center justify-between gap-3 border-t border-gray-700/50">
              <span className="text-sm text-gray-300">Revenue from deals won in this cohort</span>
              <span className="text-lg font-bold text-green-400 tabular-nums" title={fullCurrency(counts.revenue)}>
                {compactCurrency(counts.revenue)}
              </span>
            </div>
          </section>

          {/* ── Monthly trend ── */}
          <section className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-900">
              <p className="card-section-title">Created per month</p>
              {/* It is hard-wired to 12 months and ignores the period control
                  while honouring the rep filter, so switching to This Month
                  changed every card except this one, silently. */}
              <p className="text-xs text-gray-400 mt-0.5">
                Last {TREND_MONTHS} months — not affected by the period above
              </p>
            </div>
            <div className="p-4 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: chart.tick }} stroke={chart.axisLine}
                         interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tick={{ fontSize: 11, fill: chart.tick }} stroke={chart.axisLine} allowDecimals={false} />
                  <Tooltip {...chart.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12, color: chart.label }} />
                  <Area type="monotone" dataKey="leads" name="Leads"
                        stroke={chart.accents[0]} fill={chart.accents[0]} fillOpacity={0.18}
                        strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="customers" name="Customers"
                        stroke={chart.accents[3]} fill={chart.accents[3]} fillOpacity={0.18}
                        strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ── By rep ── */}
          {byRep.length > 0 && (
            <section className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-900">
                <p className="card-section-title">By salesperson</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50 bg-gray-900">
                      {['Rep', 'Created', 'Contacted', 'Contact %', 'Won', 'Win %', 'Revenue'].map(h => (
                        <th key={h} scope="col" className="px-3 py-2 text-left card-section-title whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {byRep.map((row, i) => (
                      <tr key={row.name} className="hover:bg-gray-700/40 transition-colors">
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-1.5">
                            {/* Each rep used to get a REP_COLORS dot that
                                mapped to nothing — the chart below is
                                coloured by series, not by rep. 🥇 also paints
                                its own bitmap and ignores `color`. */}
                            {i === 0
                              ? <Icon d={ICONS.trophy} className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                              : <span className="w-3.5 text-xs text-gray-400 tabular-nums text-center shrink-0">{i + 1}</span>}
                            <span className="font-medium text-gray-200 truncate">{row.name}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-300 tabular-nums">{row.cohort}</td>
                        <td className="px-3 py-2.5 text-gray-300 tabular-nums">{row.contacted}</td>
                        <td className={`px-3 py-2.5 font-medium tabular-nums ${rateColor(row.contactRate, 60, 40)}`}>
                          {pctLabel(row.contactRate)}
                        </td>
                        <td className="px-3 py-2.5 text-gray-300 tabular-nums">{row.won}</td>
                        <td className={`px-3 py-2.5 font-medium tabular-nums ${rateColor(row.winRate, 30, 15)}`}>
                          {pctLabel(row.winRate)}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-green-400 tabular-nums" title={fullCurrency(row.revenue)}>
                          {row.revenue > 0 ? compactCurrency(row.revenue) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {byRep.length > 1 && (
                <div className="px-4 pb-4 pt-3 border-t border-gray-700/50 h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byRep} margin={{ top: 0, right: 0, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: chart.tick }} stroke={chart.axisLine}
                             interval="preserveStartEnd" minTickGap={12} />
                      <YAxis tick={{ fontSize: 11, fill: chart.tick }} stroke={chart.axisLine} allowDecimals={false} />
                      <Tooltip {...chart.tooltip} />
                      <Legend wrapperStyle={{ fontSize: 12, color: chart.label }} />
                      <Bar dataKey="cohort" name="Created" fill={chart.accents[0]} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="won"    name="Won"     fill={chart.accents[3]} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          )}

          {/* ── By source ── */}
          {bySource.length > 0 && (
            <section className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-900">
                <p className="card-section-title">Lead sources</p>
              </div>
              <div className="divide-y divide-gray-700/30">
                {bySource.map(src => (
                  <SourceRow key={src.name} row={src} max={maxSource} accent={chart.accents[0]} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SourceRow({ row, max, accent }: { row: GroupRow; max: number; accent: string }) {
  const unknown = row.name === 'No source recorded'
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-24 sm:w-32 shrink-0">
        <p className={`text-sm font-medium truncate ${unknown ? 'text-gray-400 italic' : 'text-gray-200'}`} title={row.name}>
          {row.name}
        </p>
      </div>
      <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round((row.cohort / max) * 100)}%`, background: accent }}
        />
      </div>
      {/* The counts used to be three w-16/w-20 spans of "N leads" / "N
          customers" at text-xs — "25% of leads" alone needs about 73px in a
          w-12 span, so they wrapped onto two lines on every row. */}
      <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums">
        <span className="text-gray-300 w-8 text-right" title={`${row.cohort} created`}>{row.cohort}</span>
        <Icon d={ICONS.arrowRight} className="w-3 h-3 text-gray-400 shrink-0" />
        <span className="text-gray-300 w-8 text-right" title={`${row.won} won`}>{row.won}</span>
        <span className={`w-10 font-semibold text-right ${rateColor(row.winRate, 30, 15)}`}>
          {pctLabel(row.winRate)}
        </span>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, color, title }: {
  label: string
  value: string
  sub: string
  color: string
  title?: string
}) {
  return (
    <div className="card p-4">
      {/* Label first, value second — the other analytics pages all read that
          way, and the label was the line at gray-500 / 3.04:1. */}
      <p className="card-section-title">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 truncate ${color}`} title={title}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

function FunnelSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <div className="h-3 w-20 bg-gray-700/60 rounded" />
            <div className="h-7 w-16 bg-gray-700 rounded" />
            <div className="h-3 w-24 bg-gray-700/60 rounded" />
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-900">
          <div className="h-3 w-36 bg-gray-700/60 rounded" />
        </div>
        <div className="p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-28 h-3 bg-gray-700/60 rounded shrink-0" />
              <div className="flex-1 h-7 bg-gray-700 rounded-full" />
              <div className="w-12 h-4 bg-gray-700/60 rounded shrink-0" />
            </div>
          ))}
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-900">
          <div className="h-3 w-32 bg-gray-700/60 rounded" />
        </div>
        <div className="p-4"><div className="h-44 bg-gray-700/40 rounded" /></div>
      </div>
    </div>
  )
}
