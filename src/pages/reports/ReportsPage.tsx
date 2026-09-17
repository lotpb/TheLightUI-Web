import { useEffect, useMemo, useState } from 'react'
import PartialDataBanner from '../../components/PartialDataBanner'
import { Icon, ICONS } from '../../components/Icon'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useChartTheme } from '../../hooks/useChartTheme'
import { subscribeToCustomers } from '../../services/customerService'
import { subscribeToInvoices } from '../../services/invoiceService'
import type { CustomerItem } from '../../models/customer'
import type { Invoice } from '../../models/invoice'
import {
  customersInRange, fmtMoneyCompact, fmtMoneyExact, hasTrendData, invoicesInRange,
  periodRange, reportKpis, salesmanRows, sourceBreakdown, trendSeries,
  PERIODS, PERIOD_LABELS, SALESMAN_SORTS, SOURCE_FIELDS,
  type Period, type SalesmanSort, type SourceField,
} from '../../models/salesReport'
import { useAuthStore } from '../../stores/authStore'
import { usePickerStore } from '../../stores/pickerStore'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Label,
  Tooltip, ResponsiveContainer,
} from 'recharts'

export default function ReportsPage() {
  usePageTitle('Reports')
  const companyId = useAuthStore(s => s.companyId)
  const labels    = usePickerStore(s => s.labels)
  const chart     = useChartTheme()

  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [loading,   setLoading]   = useState(true)
  const [hitCap,    setHitCap]    = useState(false)
  const [invCap,    setInvCap]    = useState(false)
  const [period,    setPeriod]    = useState<Period>('month')
  const [smSort,    setSmSort]    = useState<SalesmanSort>('booked')
  const [srcField,  setSrcField]  = useState<SourceField>('leadSource')

  useEffect(() => {
    const unsub = subscribeToCustomers(
      (items, cap) => { setCustomers(items); setHitCap(!!cap); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [companyId])

  // The page reported no invoiced or collected money at all, in an app with a
  // full invoicing system — so "Revenue" could only ever mean booked deal
  // value, and nothing here could be reconciled against /invoices.
  useEffect(() => {
    const unsub = subscribeToInvoices(
      (items, cap) => { setInvoices(items); setInvCap(!!cap) },
      () => {},
    )
    return unsub
  }, [companyId])

  const range = useMemo(() => periodRange(period), [period])

  /**
   * Everything below reads from these two, so the period governs the whole
   * page. It used to feed the four KPI cards only: the rep table and the
   * sources table were all-time and the chart a fixed 12 months, so choosing
   * "Last Month" left three quarters of the page unchanged.
   */
  const periodCustomers = useMemo(
    () => customersInRange(customers, range, period),
    [customers, range, period],
  )
  const periodInvoices = useMemo(
    () => invoicesInRange(invoices, range, period),
    [invoices, range, period],
  )

  const kpi    = useMemo(() => reportKpis(periodCustomers, periodInvoices), [periodCustomers, periodInvoices])
  const reps   = useMemo(() => salesmanRows(periodCustomers, periodInvoices, smSort), [periodCustomers, periodInvoices, smSort])
  const src    = useMemo(() => sourceBreakdown(periodCustomers, srcField), [periodCustomers, srcField])
  const trend  = useMemo(() => trendSeries(customers, invoices, new Date()), [customers, invoices])
  const showTrend = hasTrendData(trend)

  const smLabel     = labels.salesman ?? 'Salesman'
  const periodLabel = PERIOD_LABELS[period]
  const srcLabel    = SOURCE_FIELDS.find(f => f.key === srcField)?.label ?? 'Lead Source'

  /**
   * Exports the whole report, not one table of it.
   *
   * The button sat beside the page title and produced only the rep table,
   * all-time, whatever period was selected — the filename was the only clue.
   */
  function exportCSV() {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines: string[] = []

    lines.push(q(`TheLight CRM — Reports (${periodLabel})`))
    lines.push(q(`Generated ${new Date().toLocaleString('en-US')}`))
    lines.push('')

    lines.push(q('Summary'))
    lines.push([q('New leads'), q(kpi.newLeads)].join(','))
    lines.push([q('New customers'), q(kpi.newCustomers)].join(','))
    lines.push([q('Booked value (new records)'), q(kpi.booked.toFixed(2))].join(','))
    lines.push([q('Avg booked per customer'), q(kpi.avgBooked.toFixed(2))].join(','))
    lines.push([q('Invoiced (issued in period)'), q(kpi.invoiced.toFixed(2))].join(','))
    lines.push([q('Collected (of those invoices)'), q(kpi.collected.toFixed(2))].join(','))
    lines.push('')

    lines.push(q(`${smLabel} performance — ${periodLabel}`))
    lines.push([smLabel, 'Leads', 'Customers', 'Conversion %', 'Booked', 'Avg booked', 'Invoiced'].map(q).join(','))
    for (const r of reps) {
      lines.push([
        q(r.name), q(r.leads), q(r.customers),
        q(r.conversion === null ? '' : r.conversion.toFixed(1)),
        q(r.booked.toFixed(2)), q(r.avgBooked.toFixed(2)), q(r.invoiced.toFixed(2)),
      ].join(','))
    }
    lines.push('')

    lines.push(q(`${srcLabel} breakdown — ${periodLabel} (${src.rows.length} of ${src.distinct} shown)`))
    lines.push([srcLabel, 'Records', 'Customers', 'Booked', 'Share % of all records'].map(q).join(','))
    for (const r of src.rows) {
      lines.push([
        q(r.source), q(r.count), q(r.customers), q(r.booked.toFixed(2)), q(r.share.toFixed(1)),
      ].join(','))
    }
    lines.push('')

    lines.push(q('Trailing 12 months'))
    lines.push(['Month', 'Booked', 'Invoiced', 'New leads', 'New customers'].map(q).join(','))
    for (const p of trend) {
      lines.push([q(p.month), q(p.booked.toFixed(2)), q(p.invoiced.toFixed(2)), q(p.leads), q(p.customers)].join(','))
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `reports-${period}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {hitCap && <PartialDataBanner totals />}
      {invCap && !hitCap && (
        <PartialDataBanner totals detail="Invoiced and Collected are computed from this subset and are understated." />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <button
          onClick={exportCSV}
          disabled={loading}
          className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {/* Was a ↓ text glyph, which renders from the UI font rather than
              taking the button's icon treatment. */}
          <Icon d={ICONS.downloadTray} className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Period selector */}
      <div>
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Reporting period">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                period === p
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-300 mt-2">
          Everything below covers <span className="font-medium text-gray-100">{periodLabel}</span>, except
          the trailing-12-month chart. Records are counted by when they were created; invoices by their
          issue date.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-20" />
          ))}
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KpiCard label="New Leads"     value={kpi.newLeads.toLocaleString()} />
            <KpiCard label="New Customers" value={kpi.newCustomers.toLocaleString()} />
            {/* Was labelled bare "Revenue". It is customer.amount on records
                created in the window — the deal value /dashboard, /chart,
                /forecast and /commission all use, and the field commission is
                paid on. Calling it Revenue read as money taken. */}
            <KpiCard label="Booked Value"  value={fmtMoneyCompact(kpi.booked)} hint="Deal value on new customer records" />
            <KpiCard label="Avg Booked"    value={fmtMoneyCompact(kpi.avgBooked)} hint="Per new customer record" />
            <KpiCard label="Invoiced"      value={fmtMoneyCompact(kpi.invoiced)} accent hint={`${kpi.invoicedCount.toLocaleString()} invoice${kpi.invoicedCount !== 1 ? 's' : ''} issued, drafts excluded`} />
            <KpiCard label="Collected"     value={fmtMoneyCompact(kpi.collected)} accent hint="Paid, of the invoices issued in this period" />
          </div>

          <p className="text-xs text-gray-300">
            Booked value and invoiced money are different quantities and won’t match: one is the amount
            recorded on a deal, the other is what was actually billed. /forecast dates the same deals by
            their completion or start date rather than by when the record was created, so its monthly
            figures will differ from these. Invoices carry no payment date, so Collected means “of the
            invoices issued in this period, this much has since been paid” — not cash received in the period.
          </p>

          {/* Trend chart */}
          {showTrend && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700 bg-gray-700/50">
                <p className="text-sm font-semibold text-gray-100">
                  Trend <span className="text-gray-300 font-normal">— trailing 12 months, not affected by the period above</span>
                </p>
              </div>
              <div className="px-2 pt-4 pb-2">
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    {/* Every colour here was a hardcoded dark-mode hex. The
                        grid was #374151: 1.42:1 on the dark card, which is no
                        gridline at all, and 10.31:1 on white, which is a black
                        rule over white. useChartTheme carries a measured
                        palette per theme. */}
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: chart.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="money"
                      tick={{ fill: chart.tick, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                      tickFormatter={fmtMoneyCompact}
                    >
                      {/* The two axes were undisclosed, so a flat bar beside a
                          climbing line read as a relationship at whatever
                          ratio recharts happened to choose. */}
                      <Label value="$" position="insideTopLeft" fill={chart.label} fontSize={11} offset={4} />
                    </YAxis>
                    <YAxis
                      yAxisId="count"
                      orientation="right"
                      tick={{ fill: chart.tick, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={34}
                      allowDecimals={false}
                    >
                      <Label value="leads" position="insideTopRight" fill={chart.label} fontSize={11} offset={4} />
                    </YAxis>
                    <Tooltip
                      {...chart.tooltip}
                      formatter={(value: number, name: string) => {
                        if (name === 'booked')   return [fmtMoneyExact(value), 'Booked value']
                        if (name === 'invoiced') return [fmtMoneyExact(value), 'Invoiced']
                        if (name === 'leads')    return [value.toLocaleString(), 'New leads']
                        return [value, name]
                      }}
                    />
                    <Bar  yAxisId="money" dataKey="booked"   fill={chart.accents[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar  yAxisId="money" dataKey="invoiced" fill={chart.accents[3]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Line yAxisId="count" dataKey="leads" type="monotone" stroke={chart.accents[4]} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-4 flex-wrap mt-1">
                  <LegendSwatch color={chart.accents[0]} label="Booked value ($, left)" />
                  <LegendSwatch color={chart.accents[3]} label="Invoiced ($, left)" />
                  <LegendSwatch color={chart.accents[4]} label="New leads (count, right)" line />
                </div>
              </div>
            </div>
          )}

          {/* Rep performance */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-700 bg-gray-700/50 flex-wrap">
              <p className="text-sm font-semibold text-gray-100">
                {smLabel} Performance <span className="text-gray-300 font-normal">— {periodLabel}</span>
              </p>
              <div className="flex gap-1 flex-wrap">
                {SALESMAN_SORTS.map(s => (
                  <button
                    key={s.key}
                    onClick={() => setSmSort(s.key)}
                    aria-pressed={smSort === s.key}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                      smSort === s.key
                        ? 'bg-indigo-600/20 text-indigo-200'
                        : 'text-gray-300 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {reps.length === 0 ? (
              <p className="text-gray-300 text-sm text-center py-8">No leads or customers in {periodLabel}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-300 uppercase tracking-wider border-b border-gray-700">
                      <th className="px-4 py-2 text-left font-medium">{smLabel}</th>
                      <th className="px-3 py-2 text-right font-medium">Leads</th>
                      <th className="px-3 py-2 text-right font-medium">Cust.</th>
                      <th className="px-3 py-2 text-right font-medium" title="Customers ÷ (leads + customers)">Conv %</th>
                      <th className="px-3 py-2 text-right font-medium">Booked</th>
                      <th className="px-3 py-2 text-right font-medium">Invoiced</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {reps.map((r, i) => (
                      <tr key={r.name} className="hover:bg-gray-700/50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-100 font-medium">
                          {/* Was text-gray-600 — 1.94:1. */}
                          <span className="text-gray-400 text-xs mr-2 tabular-nums">#{i + 1}</span>
                          {r.name}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-200 tabular-nums">{r.leads}</td>
                        <td className="px-3 py-2.5 text-right text-gray-200 tabular-nums">{r.customers}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {r.conversion !== null ? (
                            <span className={`text-xs font-semibold ${
                              r.conversion >= 50 ? 'text-green-400' : r.conversion >= 25 ? 'text-yellow-400' : 'text-gray-300'
                            }`}>
                              {r.conversion.toFixed(0)}%
                            </span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-100 font-semibold tabular-nums">
                          {r.booked > 0 ? fmtMoneyExact(r.booked) : <span className="text-gray-400 font-normal">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-green-400 font-semibold tabular-nums">
                          {r.invoiced > 0 ? fmtMoneyExact(r.invoiced) : <span className="text-gray-400 font-normal">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sources */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-700 bg-gray-700/50 flex-wrap">
              <p className="text-sm font-semibold text-gray-100">
                {srcLabel} <span className="text-gray-300 font-normal">— {periodLabel}</span>
              </p>
              {/* The table was headed "Lead Sources" and grouped on adNo,
                  which /customers shows as "ID {adNo}" and pickerStore pairs
                  with advertiser, while /chart and /funnel both group on
                  leadSource. Either field is defensible; labelling one as the
                  other is not. */}
              <div className="flex gap-1">
                {SOURCE_FIELDS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setSrcField(f.key)}
                    aria-pressed={srcField === f.key}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                      srcField === f.key
                        ? 'bg-indigo-600/20 text-indigo-200'
                        : 'text-gray-300 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {src.rows.length === 0 ? (
              <p className="text-gray-300 text-sm text-center py-8">No records with a {srcLabel.toLowerCase()} in {periodLabel}.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-300 uppercase tracking-wider border-b border-gray-700">
                        <th className="px-4 py-2 text-left font-medium">{srcLabel}</th>
                        <th className="px-3 py-2 text-right font-medium">Records</th>
                        <th className="px-3 py-2 text-right font-medium">Cust.</th>
                        <th className="px-3 py-2 text-right font-medium">Booked</th>
                        <th className="px-3 py-2 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {src.rows.map(r => (
                        <tr key={r.source} className="hover:bg-gray-700/50 transition-colors">
                          <td className="px-4 py-2.5 text-gray-100">{r.source}</td>
                          <td className="px-3 py-2.5 text-right text-gray-200 tabular-nums">{r.count}</td>
                          <td className="px-3 py-2.5 text-right text-gray-200 tabular-nums">{r.customers}</td>
                          <td className="px-3 py-2.5 text-right text-gray-100 tabular-nums">
                            {r.booked > 0 ? fmtMoneyExact(r.booked) : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${r.share}%` }} />
                              </div>
                              <span className="text-xs text-gray-200 tabular-nums w-9 text-right">
                                {r.share.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Share divided by the sum of the ten rows on screen, so the
                    displayed percentages always totalled 100% and every one
                    was inflated whenever more than ten sources existed. */}
                <p className="px-4 py-2 text-xs text-gray-300 border-t border-gray-700 bg-gray-700/40">
                  Top {src.rows.length} of {src.distinct.toLocaleString()} {src.distinct === 1 ? 'source' : 'sources'}.
                  Share is of all {src.total.toLocaleString()} leads and customers in {periodLabel}, so these rows
                  won’t add to 100%.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, accent, hint }: {
  label: string
  value: string
  accent?: boolean
  hint?: string
}) {
  return (
    <div className="card p-4">
      {/* Was text-gray-500 — 3.04:1 — on the only text saying what the number
          underneath it means. */}
      <p className="text-xs text-gray-300 mb-1.5">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accent ? 'text-green-400' : 'text-white'}`}>{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

function LegendSwatch({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {line
        ? <div className="w-5 border-t-2" style={{ borderColor: color }} />
        : <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />}
      <span className="text-xs text-gray-300">{label}</span>
    </div>
  )
}
