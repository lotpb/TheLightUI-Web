import { useEffect, useMemo, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, type TooltipProps,
} from 'recharts'

import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { subscribeToCustomers } from '../../services/customerService'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useChartTheme } from '../../hooks/useChartTheme'
import { compactCurrency, fullCurrency } from '../../utils/currency'
import {
  buildSeries, buildChartRows, forecastRevenue, growthRate, lastNMonths, monthKey,
  formatMonth, BASIS_MONTHS, MIN_BASIS, type ForecastResult,
} from '../../utils/forecast'
import type { CustomerItem } from '../../models/customer'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EPOCH_THRESHOLD = 86_400_000   // dates at/before epoch+1day are sentinel zeros

function isValidDate(d: Date | null): d is Date { return !!d && d.getTime() > EPOCH_THRESHOLD }
function isCustomer(c: CustomerItem) { return c.category.toLowerCase() === 'customer' }
function isLead(c: CustomerItem)     { return c.category.toLowerCase() === 'lead' }

function revenueDate(c: CustomerItem): Date | null {
  if (isValidDate(c.completionDate)) return c.completionDate
  if (isValidDate(c.startDate))      return c.startDate
  return null
}

function fmtPct(n: number) {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

type Period = '6m' | '12m' | 'ytd' | 'all'
type Horizon = 3 | 6 | 12

const PERIOD_LABEL: Record<Period, string> = {
  ytd: 'year to date',
  '6m': 'the last 6 months',
  '12m': 'the last 12 months',
  all:  'the last 24 months',
}

/**
 * How many months the chart and the KPIs cover.
 *
 * "All" is 24 months, not all time. It always was for the chart — but the
 * KPIs summed every record ever while dividing by the months in this window,
 * so "Monthly Avg" reported an all-time total spread over at most 24 months.
 * On the 2015 import that is wrong by an order of magnitude. One window now
 * feeds both.
 */
function windowMonths(period: Period, now: Date): number {
  if (period === '6m')  return 6
  if (period === '12m') return 12
  if (period === 'ytd') return now.getMonth() + 1
  return 24
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  usePageTitle('Revenue Forecast')

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [hitCap, setHitCap]       = useState(false)
  const [period, setPeriod]       = useState<Period>('12m')
  const [horizon, setHorizon]     = useState<Horizon>(6)
  const [repFilter, setRepFilter] = useState('all')

  const chart = useChartTheme()

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

  const filtered = useMemo(() => (
    repFilter === 'all' ? customers : customers.filter(c => c.salesman === repFilter)
  ), [customers, repFilter])

  const revenueRecords = useMemo(() => (
    filtered
      .filter(c => isCustomer(c) && c.amount > 0)
      .map(c => ({ date: revenueDate(c), amount: c.amount, salesman: c.salesman }))
      .filter((r): r is { date: Date; amount: number; salesman: string } => r.date !== null)
  ), [filtered])

  const now = useMemo(() => new Date(), [])

  /** What the chart and the KPIs describe. */
  const displaySeries = useMemo(
    () => buildSeries(revenueRecords, lastNMonths(windowMonths(period, now), now), now),
    [revenueRecords, period, now],
  )

  /**
   * What the projection is fitted to — always the same twelve months, whatever
   * the display window says.
   *
   * The forecast used to read the period-filtered history, so the buttons
   * labelled YTD / 6M / 12M / All silently rewrote the projection as well as
   * the view. Picking YTD in January left one data point and the page
   * announced "Need at least 2 months of data" to a company with years of it.
   */
  const basisSeries = useMemo(
    () => buildSeries(revenueRecords, lastNMonths(12, now), now),
    [revenueRecords, now],
  )

  const forecast: ForecastResult | null = useMemo(
    () => forecastRevenue(basisSeries, horizon, now),
    [basisSeries, horizon, now],
  )

  const complete = useMemo(() => displaySeries.filter(p => !p.partial), [displaySeries])
  const currentMonth = monthKey(now)

  // ── KPIs, all from one window ──
  const windowRevenue = complete.reduce((s, p) => s + p.revenue, 0)
  const windowDeals   = complete.reduce((s, p) => s + p.deals, 0)
  const avgDeal       = windowDeals > 0 ? windowRevenue / windowDeals : 0
  const activeMonths  = complete.filter(p => p.revenue > 0).length
  const avgMonthly    = activeMonths > 0 ? windowRevenue / activeMonths : 0
  const growth        = useMemo(() => growthRate(displaySeries), [displaySeries])
  const projectedTotal = (forecast?.points ?? []).reduce((s, p) => s + p.projected, 0)

  const pipelineRecords = useMemo(
    () => filtered.filter(c => isLead(c) && c.amount > 0).slice().sort((a, b) => b.amount - a.amount),
    [filtered],
  )
  const pipelineTotal = pipelineRecords.reduce((s, c) => s + c.amount, 0)
  const pipelineMax   = pipelineRecords[0]?.amount ?? 0

  const byRep = useMemo(() => {
    const inWindow = new Set(complete.map(p => p.key))
    const map = new Map<string, { revenue: number; deals: number }>()
    for (const r of revenueRecords) {
      if (!inWindow.has(monthKey(r.date))) continue
      const rep = r.salesman || 'Unassigned'
      const cur = map.get(rep) ?? { revenue: 0, deals: 0 }
      map.set(rep, { revenue: cur.revenue + r.amount, deals: cur.deals + 1 })
    }
    return Array.from(map.entries())
      .map(([rep, v]) => ({ rep, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [revenueRecords, complete])

  const chartData = useMemo(
    () => buildChartRows(displaySeries, forecast?.points ?? []),
    [displaySeries, forecast],
  )

  const hasChartData = chartData.some(d => (d.actual ?? 0) > 0 || (d.partial ?? 0) > 0 || (d.projected ?? 0) > 0)

  const revenueTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload as { key: string; low: number | null; band: number | null } | undefined
    const lines = payload.filter(p => p.value != null && p.dataKey !== 'low' && p.dataKey !== 'band')
    if (lines.length === 0) return null
    return (
      <div style={chart.tooltip.contentStyle} className="p-3 text-xs">
        <p style={chart.tooltip.labelStyle} className="mb-1.5">{label}</p>
        {lines.map(p => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color ?? chart.accents[0] }} />
            <span style={chart.tooltip.itemStyle}>
              {p.dataKey === 'partial' ? 'This month so far' : p.dataKey === 'projected' ? 'Projected' : 'Actual'}:
            </span>
            <span style={chart.tooltip.labelStyle}>{fullCurrency(p.value ?? 0)}</span>
          </div>
        ))}
        {row?.low != null && row.band != null && (
          <p style={chart.tooltip.itemStyle} className="mt-1.5 pt-1.5 border-t border-current/20">
            Range {compactCurrency(row.low)} – {compactCurrency(row.low + row.band)}
          </p>
        )}
      </div>
    )
  }

  if (loading) return <ForecastSkeleton />

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Was a bare block statement in the component body — `{hitCap && <…/>}`
          at statement position is a block, not JSX, so the element was built
          and discarded. It had never rendered. */}
      {hitCap && <PartialDataBanner totals />}

      <div>
        <h1 className="text-2xl font-bold text-white">Revenue Forecast</h1>
        {/* The period is named here as well as in the control, because every
            figure below it is scoped to that window and nothing said so. */}
        <p className="text-sm text-gray-400 mt-0.5">
          Revenue over {PERIOD_LABEL[period]}, projected {horizon} months forward
          {repFilter !== 'all' && <> · {repFilter}</>}
        </p>
      </div>

      {/* ── Controls ── */}
      <div className="card p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          label="History window"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'ytd' as const, label: 'YTD' },
            { value: '6m'  as const, label: '6M' },
            { value: '12m' as const, label: '12M' },
            { value: 'all' as const, label: '24M' },
          ]}
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Project</span>
          <Segmented
            label="Forecast horizon"
            value={horizon}
            onChange={setHorizon}
            accent="violet"
            options={[
              { value: 3  as const, label: '+3mo' },
              { value: 6  as const, label: '+6mo' },
              { value: 12 as const, label: '+12mo' },
            ]}
          />
        </div>
        <label htmlFor="fc-rep" className="sr-only">Salesperson</label>
        <select
          id="fc-rep"
          value={repFilter}
          onChange={e => setRepFilter(e.target.value)}
          className="input-field text-sm py-1.5 pr-8 w-auto ml-auto"
        >
          <option value="all">All salespeople</option>
          {allReps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Revenue"
          value={compactCurrency(windowRevenue)}
          title={fullCurrency(windowRevenue)}
          sub={`${windowDeals.toLocaleString()} deal${windowDeals === 1 ? '' : 's'} · ${PERIOD_LABEL[period]}`}
          color="text-green-400"
        />
        <KpiCard
          label="Avg deal size"
          value={compactCurrency(avgDeal)}
          title={fullCurrency(avgDeal)}
          sub="per closed deal"
          color="text-indigo-400"
        />
        <KpiCard
          label="Monthly avg"
          value={compactCurrency(avgMonthly)}
          title={fullCurrency(avgMonthly)}
          sub={growth !== null ? `${fmtPct(growth)} vs the half before` : `across ${activeMonths} active month${activeMonths === 1 ? '' : 's'}`}
          color={growth !== null && growth < 0 ? 'text-red-400' : 'text-green-400'}
        />
        <KpiCard
          label={`Next ${horizon} months`}
          value={forecast ? compactCurrency(projectedTotal) : '—'}
          title={forecast ? fullCurrency(projectedTotal) : undefined}
          sub={forecast ? TREND_SUB[forecast.trend] : `Needs ${MIN_BASIS} complete months`}
          color="text-violet-400"
        />
      </div>

      {/* ── Revenue trend + forecast ── */}
      <div className="card p-4">
        <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
          <p className="card-section-title">Revenue trend &amp; forecast</p>
          <div className="flex items-center gap-4 text-xs text-gray-300">
            <LegendSwatch color={chart.accents[3]}>Actual</LegendSwatch>
            <LegendSwatch color={chart.accents[3]} faded>This month (partial)</LegendSwatch>
            <LegendSwatch color={chart.accents[1]} dashed>Projected</LegendSwatch>
          </div>
        </div>

        {hasChartData ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ left: 0, right: 16, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis
                dataKey="month"
                tick={{ fill: chart.tick, fontSize: 11 }}
                stroke={chart.axisLine}
                /* At 24 months of history plus a 12-month horizon there are 36
                   categories in about 960px — 26px each for labels needing 38. */
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                tickFormatter={compactCurrency}
                tick={{ fill: chart.tick, fontSize: 11 }}
                stroke={chart.axisLine}
                width={60}
              />
              <Tooltip content={revenueTooltip} cursor={{ stroke: chart.axisLine, strokeDasharray: '3 3' }} />
              <ReferenceLine
                x={formatMonth(currentMonth)}
                stroke={chart.axisLine}
                strokeDasharray="4 3"
                label={{ value: 'This month', fill: chart.tick, fontSize: 10, position: 'insideTopRight' }}
              />

              {/* The prediction interval, as two stacked areas: an invisible
                  base at `low` and the band's own height on top of it.
                  It used to be faked by painting a second area in a
                  hard-coded #1f2937 — the dark card colour — which in light
                  mode laid a navy wedge across the forecast. */}
              <Area dataKey="low"  stackId="band" stroke="none" fill="none" isAnimationActive={false} legendType="none" />
              <Area dataKey="band" stackId="band" stroke="none" fill={chart.accents[1]} fillOpacity={0.16} isAnimationActive={false} legendType="none" />

              <Area
                type="monotone" dataKey="actual" stroke={chart.accents[3]} strokeWidth={2}
                fill={chart.accents[3]} fillOpacity={0.14}
                dot={{ r: 3, fill: chart.accents[3], strokeWidth: 0 }} activeDot={{ r: 5 }}
                connectNulls={false}
              />
              {/* Drawn apart from `actual` so a month that is 10% elapsed
                  doesn't read as a month that collapsed. */}
              <Area
                type="monotone" dataKey="partial" stroke={chart.accents[3]} strokeWidth={2}
                strokeDasharray="2 3" strokeOpacity={0.65}
                fill={chart.accents[3]} fillOpacity={0.05}
                dot={{ r: 3, fill: chart.accents[3], fillOpacity: 0.5, strokeWidth: 0 }} activeDot={{ r: 5 }}
                connectNulls={false}
              />
              <Area
                type="monotone" dataKey="projected" stroke={chart.accents[1]} strokeWidth={2}
                strokeDasharray="5 3" fill="none"
                dot={{ r: 3, fill: chart.accents[1], strokeWidth: 0 }} activeDot={{ r: 5 }}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyPanel height="h-[220px]">No revenue in {PERIOD_LABEL[period]}</EmptyPanel>
        )}

        {/* Was text-gray-600 — 1.94:1, the least readable thing on a page
            whose right-hand half is an estimate. */}
        <p className="text-xs text-gray-400 mt-3 text-center">
          {forecast ? (
            <>
              Straight-line trend over the last {forecast.basisMonths} complete month
              {forecast.basisMonths === 1 ? '' : 's'} — the month in progress is excluded, and the
              basis doesn&rsquo;t change with the history window above. The shaded band is a 95%
              prediction interval from the spread of those months, so it widens with distance.
              {forecast.stdError === 0 && ' Those months fall exactly on a line, so the band has no width.'}
            </>
          ) : (
            <>Not enough history to project: {MIN_BASIS} complete months are needed.</>
          )}
        </p>

        {forecast?.trend === 'declining' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
            <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-px" />
            {/* The old projection was floored at zero point by point, so a
                decline rendered as a flat $0 line and a table of zeros with
                no explanation anywhere. */}
            <span>
              Revenue is trending down about {compactCurrency(Math.abs(forecast.slope))} a month.
              {forecast.monthsToZero !== null && (
                <> At this rate the trend reaches zero in {forecast.monthsToZero} month{forecast.monthsToZero === 1 ? '' : 's'}, which is why the projection flattens — revenue can&rsquo;t go negative.</>
              )}
            </span>
          </div>
        )}
      </div>

      {/* ── Deals per month ── */}
      <div className="card p-4">
        <p className="card-section-title">Deals by revenue date</p>
        {/* Titled "Deals Closed Per Month" while counting completionDate where
            set and startDate otherwise — so a job that started and never
            finished was counted as closed. */}
        <p className="text-xs text-gray-400 mt-1 mb-3">
          Dated by completion where recorded, otherwise by start
        </p>
        {displaySeries.some(p => p.deals > 0) ? (
          <ResponsiveContainer width="100%" height={170}>
            <BarChart
              data={displaySeries.map(p => ({ month: formatMonth(p.key), deals: p.deals, partial: p.partial }))}
              margin={{ left: 0, right: 16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: chart.tick, fontSize: 11 }} stroke={chart.axisLine}
                     interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} stroke={chart.axisLine} width={28} allowDecimals={false} />
              <Tooltip
                contentStyle={chart.tooltip.contentStyle}
                labelStyle={chart.tooltip.labelStyle}
                itemStyle={chart.tooltip.itemStyle}
                cursor={false}
                formatter={(v: number) => [v, 'Deals']}
              />
              <Bar dataKey="deals" name="Deals" fill={chart.accents[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyPanel height="h-[110px]">No deals in {PERIOD_LABEL[period]}</EmptyPanel>
        )}
      </div>

      {/* ── By rep + forecast table ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card overflow-hidden">
          {/* bg-gray-800/50 on a bg-gray-800 card is 1.000:1 in both themes. */}
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-900">
            <p className="card-section-title">By salesperson</p>
          </div>
          {byRep.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/40 bg-gray-900">
                  <th scope="col" className="text-left px-4 py-2 card-section-title">Rep</th>
                  <th scope="col" className="text-right px-4 py-2 card-section-title">Revenue</th>
                  <th scope="col" className="text-right px-4 py-2 card-section-title">Deals</th>
                  <th scope="col" className="text-right px-4 py-2 card-section-title">Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {byRep.map((r, i) => (
                  <tr key={r.rep} className="hover:bg-gray-700/40 transition-colors">
                    <td className="px-4 py-2.5 text-gray-200 font-medium">
                      <span className="flex items-center gap-1.5">
                        {/* 🥇🥈🥉 paint their own bitmap and ignore `color`,
                            and the ranks below them were gray-600 at 1.94:1. */}
                        {i === 0
                          ? <Icon d={ICONS.trophy} className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                          : <span className="w-3.5 text-xs text-gray-400 tabular-nums text-center shrink-0">{i + 1}</span>}
                        <span className="truncate">{r.rep}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-green-400 font-semibold text-right tabular-nums" title={fullCurrency(r.revenue)}>{compactCurrency(r.revenue)}</td>
                    <td className="px-4 py-2.5 text-gray-300 text-right tabular-nums">{r.deals}</td>
                    <td className="px-4 py-2.5 text-gray-300 text-right tabular-nums" title={fullCurrency(r.revenue / r.deals)}>{compactCurrency(r.revenue / r.deals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyPanel>No revenue in {PERIOD_LABEL[period]}</EmptyPanel>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-900">
            <p className="card-section-title">Monthly forecast · next {horizon} months</p>
          </div>
          {forecast ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/40 bg-gray-900">
                  <th scope="col" className="text-left px-4 py-2 card-section-title">Month</th>
                  <th scope="col" className="text-right px-4 py-2 card-section-title">Low</th>
                  <th scope="col" className="text-right px-4 py-2 card-section-title">Projected</th>
                  <th scope="col" className="text-right px-4 py-2 card-section-title">High</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {forecast.points.map(f => (
                  <tr key={f.key} className="hover:bg-gray-700/40 transition-colors">
                    <td className="px-4 py-2.5 text-gray-200 font-medium">{formatMonth(f.key)}</td>
                    {/* Was gray-500 at 3.04:1 on both bounds of the range. */}
                    <td className="px-4 py-2.5 text-gray-300 text-right tabular-nums" title={fullCurrency(f.low)}>{compactCurrency(f.low)}</td>
                    <td className="px-4 py-2.5 text-violet-300 font-semibold text-right tabular-nums" title={fullCurrency(f.projected)}>{compactCurrency(f.projected)}</td>
                    <td className="px-4 py-2.5 text-gray-300 text-right tabular-nums" title={fullCurrency(f.high)}>{compactCurrency(f.high)}</td>
                  </tr>
                ))}
                {/* bg-gray-800/30 made the one row meant to stand out the one
                    row you couldn't see. */}
                <tr className="border-t-2 border-gray-600 bg-gray-900">
                  <td className="px-4 py-2.5 font-semibold text-gray-200">Total</td>
                  <td className="px-4 py-2.5 text-gray-300 font-semibold text-right tabular-nums">
                    {compactCurrency(forecast.points.reduce((s, f) => s + f.low, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-violet-300 font-bold text-right tabular-nums">
                    {compactCurrency(projectedTotal)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 font-semibold text-right tabular-nums">
                    {compactCurrency(forecast.points.reduce((s, f) => s + f.high, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <EmptyPanel>
              Needs {MIN_BASIS} complete months of revenue to project. The fit uses up to the
              last {BASIS_MONTHS}.
            </EmptyPanel>
          )}
        </section>
      </div>

      {/* ── Pipeline ── */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="card-section-title">Pipeline · open leads with an estimated value</p>
          {pipelineTotal > 0 && (
            <span className="text-sm font-bold text-indigo-300 shrink-0" title={fullCurrency(pipelineTotal)}>
              {compactCurrency(pipelineTotal)}
            </span>
          )}
        </div>
        {/* It sat in the forecast KPI as though it fed the projection. It
            doesn't: these leads have no close date and no probability. */}
        <p className="text-xs text-gray-400 mb-3">
          Not included in the projection above — these have no close date or win probability
        </p>
        {pipelineRecords.length > 0 ? (
          <div className="space-y-2">
            {pipelineRecords.slice(0, 10).map(c => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate">{`${c.first} ${c.lastname}`.trim() || 'Unnamed lead'}</p>
                  {c.salesman && <p className="text-xs text-gray-400">{c.salesman}</p>}
                </div>
                <span className="text-sm font-semibold text-indigo-300 shrink-0 tabular-nums" title={fullCurrency(c.amount)}>
                  {compactCurrency(c.amount)}
                </span>
                <div className="w-24 h-1.5 rounded-full bg-gray-700 overflow-hidden shrink-0">
                  <div
                    className="h-full rounded-full bg-indigo-500"
                    style={{ width: `${pipelineMax > 0 ? Math.round((c.amount / pipelineMax) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
            {pipelineRecords.length > 10 && (
              <p className="text-xs text-gray-400 pt-1">
                + {pipelineRecords.length - 10} more lead{pipelineRecords.length - 10 === 1 ? '' : 's'} in pipeline
              </p>
            )}
          </div>
        ) : (
          /* The whole card used to disappear, so the page silently changed
             shape depending on the rep filter. */
          <p className="text-sm text-gray-400 py-4 text-center">
            No open leads have an estimated value{repFilter !== 'all' && <> for {repFilter}</>}.
          </p>
        )}
      </div>
    </div>
  )
}

const TREND_SUB: Record<'rising' | 'flat' | 'declining', string> = {
  rising:    'Trending up',
  flat:      'Holding steady',
  declining: 'Trending down',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Segmented<T extends string | number>({ label, value, onChange, options, accent = 'indigo' }: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  accent?: 'indigo' | 'violet'
}) {
  const on = accent === 'violet' ? 'bg-violet-600 text-white' : 'bg-indigo-600 text-white'
  return (
    <div role="group" aria-label={label} className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 font-medium transition-colors
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
            value === o.value ? on : 'text-gray-400 hover:text-gray-100 hover:bg-gray-700/40'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function LegendSwatch({ color, dashed, faded, children }: {
  color: string
  dashed?: boolean
  faded?: boolean
  children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-4 h-0.5 shrink-0"
        style={dashed
          ? { borderTop: `2px dashed ${color}`, opacity: faded ? 0.65 : 1 }
          : { background: color, opacity: faded ? 0.45 : 1 }}
      />
      {children}
    </span>
  )
}

function EmptyPanel({ children, height = 'py-8' }: { children: React.ReactNode; height?: string }) {
  return (
    <div className={`flex items-center justify-center px-4 text-center text-gray-400 text-sm ${height}`}>
      {children}
    </div>
  )
}

function KpiCard({ label, value, sub, color, title }: {
  label: string
  value: string
  sub: string
  color: string
  title?: string
}) {
  return (
    <div className="card p-4">
      <p className="card-section-title">{label}</p>
      {/* text-2xl put "$1.23M" into 139px of content width at 390px and
          `truncate` silently cut it; it steps up at sm like /chart. */}
      <p className={`text-xl sm:text-2xl font-bold mt-1 truncate ${color}`} title={title}>{value}</p>
      {/* Was gray-500 at 3.04:1 on all four cards. */}
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

function ForecastSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-56 bg-gray-700 rounded" />
        <div className="h-4 w-72 bg-gray-700/60 rounded" />
      </div>
      <div className="card p-3 flex flex-wrap gap-3">
        <div className="h-9 w-48 bg-gray-700 rounded-lg" />
        <div className="h-9 w-44 bg-gray-700 rounded-lg" />
        <div className="h-9 w-44 bg-gray-700 rounded-lg ml-auto" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <div className="h-3 w-20 bg-gray-700/60 rounded" />
            <div className="h-7 w-24 bg-gray-700 rounded" />
            <div className="h-3 w-28 bg-gray-700/60 rounded" />
          </div>
        ))}
      </div>
      <div className="card p-4 space-y-3">
        <div className="h-3 w-40 bg-gray-700/60 rounded" />
        <div className="h-[300px] bg-gray-700/40 rounded" />
      </div>
      <div className="card p-4 space-y-3">
        <div className="h-3 w-36 bg-gray-700/60 rounded" />
        <div className="h-[170px] bg-gray-700/40 rounded" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-900">
              <div className="h-3 w-28 bg-gray-700/60 rounded" />
            </div>
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="px-4 h-[41px] flex items-center border-b border-gray-700/30">
                <div className="h-3.5 w-full bg-gray-700/60 rounded" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
