import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToPurchaseOrders } from '../../services/purchaseOrderService'
import { type PurchaseOrder, poTotal, fmtCurrency } from '../../models/purchaseOrder'
import { Icon, ICONS } from '../../components/Icon'

interface VendorScore {
  vendorId: string
  vendorName: string
  totalPOs: number
  draftCount: number
  receivedCount: number
  cancelledCount: number
  onTimeCount: number
  ratedCount: number       // received POs that had an expectedDate to judge against
  onTimeRate: number | null // null = not enough data
  avgLeadDays: number | null
  leadSampleCount: number  // received POs with a usable receivedDate
  invalidLeadCount: number // receivedDate before orderDate — a data-entry slip
  totalSpend: number
}

type SortBy = 'spend' | 'onTime' | 'volume'

/**
 * Below this many rated POs, an on-time percentage isn't a verdict.
 *
 * One PO delivered on time is "100%", and it used to render in the same bold
 * green as 47 out of 50. Under the threshold the rate is shown but left
 * neutral-coloured and labelled provisional, so the colour only ever means
 * something when there's enough behind it to mean anything.
 */
const MIN_CONFIDENT_SAMPLE = 5

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** Colour only once the sample supports a judgement. */
function rateColor(rate: number | null, ratedCount: number): string {
  if (rate === null) return 'text-gray-400'
  if (ratedCount < MIN_CONFIDENT_SAMPLE) return 'text-gray-200'
  if (rate >= 90) return 'text-green-400'
  if (rate >= 70) return 'text-yellow-400'
  return 'text-red-400'
}

export default function VendorScorecardsPage() {
  usePageTitle('Vendor Scorecards')

  const [pos, setPOs] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortBy>('spend')

  useEffect(() => subscribeToPurchaseOrders(
    items => { setPOs(items); setLoading(false) },
    () => setLoading(false),
  ), [])

  const scores = useMemo<VendorScore[]>(() => {
    const byVendor = new Map<string, PurchaseOrder[]>()
    for (const po of pos) {
      const key = po.vendorId || po.vendorName
      if (!key) continue
      if (!byVendor.has(key)) byVendor.set(key, [])
      byVendor.get(key)!.push(po)
    }

    const results: VendorScore[] = []
    for (const [key, vendorPOs] of byVendor) {
      const received  = vendorPOs.filter(p => p.status === 'received')
      const cancelled = vendorPOs.filter(p => p.status === 'cancelled')
      const drafts    = vendorPOs.filter(p => p.status === 'draft')
      const rated     = received.filter(p => p.expectedDate && p.receivedDate)
      const onTime    = rated.filter(p => p.receivedDate! <= p.expectedDate!)

      // A receivedDate before its orderDate is a data-entry slip, not a
      // negative lead time. Those used to drag the average below zero and
      // render as "-3d"; they're excluded and counted instead.
      const allLeads = received
        .filter(p => p.receivedDate)
        .map(p => daysBetween(p.orderDate, p.receivedDate!))
      const leadTimes = allLeads.filter(d => d >= 0)

      results.push({
        vendorId: vendorPOs[0].vendorId,
        vendorName: vendorPOs[0].vendorName || key,
        totalPOs: vendorPOs.length,
        draftCount: drafts.length,
        receivedCount: received.length,
        cancelledCount: cancelled.length,
        onTimeCount: onTime.length,
        ratedCount: rated.length,
        onTimeRate: rated.length > 0 ? Math.round((onTime.length / rated.length) * 100) : null,
        avgLeadDays: leadTimes.length > 0 ? Math.round(leadTimes.reduce((s, d) => s + d, 0) / leadTimes.length) : null,
        leadSampleCount: leadTimes.length,
        invalidLeadCount: allLeads.length - leadTimes.length,
        totalSpend: vendorPOs.filter(p => p.status !== 'cancelled').reduce((s, p) => s + poTotal(p), 0),
      })
    }

    return results.sort((a, b) => {
      if (sortBy === 'spend')  return b.totalSpend - a.totalSpend
      if (sortBy === 'volume') return b.totalPOs - a.totalPOs
      // onTime: unrated vendors sink to the bottom
      const ar = a.onTimeRate ?? -1
      const br = b.onTimeRate ?? -1
      return br - ar
    })
  }, [pos, sortBy])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-white">Vendor Scorecards</h1>
          <p className="text-sm text-gray-400 mt-0.5">On-time delivery, lead time &amp; spend, derived from Purchase Orders</p>
        </div>
        {/* The select had no label and no accessible name — only the text inside
            its own options. */}
        <div className="shrink-0">
          <label htmlFor="vs-sort" className="sr-only">Sort vendors by</label>
          <select
            id="vs-sort"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortBy)}
            className="input-field text-sm py-1.5 w-44"
          >
            <option value="spend">Sort by Spend</option>
            <option value="onTime">Sort by On-Time Rate</option>
            <option value="volume">Sort by PO Volume</option>
          </select>
        </div>
      </div>

      {/* The 90/70 thresholds were hard-coded with no key anywhere, so a vendor
          at 85% read as "bad" without the reader knowing the bands. */}
      {!loading && scores.length > 0 && (
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mb-4 text-xs text-gray-400">
          <span className="font-medium">On-time bands:</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400" />90%+</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400" />70–89%</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" />under 70%</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300" />under {MIN_CONFIDENT_SAMPLE} rated — provisional</span>
        </div>
      )}

      {loading ? (
        /* Card skeletons rather than a single "Loading…" line, which made the
           page jump from one 20px row to several hundred pixels of cards. */
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="h-4 w-40 bg-gray-700 rounded" />
                  <div className="h-3 w-32 bg-gray-700/60 rounded" />
                </div>
                <div className="h-5 w-24 bg-gray-700 rounded" />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-700/40">
                {[0, 1].map(j => (
                  <div key={j} className="space-y-2">
                    <div className="h-3 w-24 bg-gray-700/60 rounded" />
                    <div className="h-5 w-16 bg-gray-700 rounded" />
                    <div className="h-3 w-28 bg-gray-700/60 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : scores.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No purchase orders yet</p>
          <p className="text-sm text-gray-400 mt-1">Scorecards build up automatically as Purchase Orders are created and received.</p>
          {/* The empty state named its dependency without offering a way there. */}
          <Link to="/purchase-orders" className="inline-flex items-center gap-1.5 btn-primary text-sm px-4 py-2 mt-4">
            <Icon d={ICONS.clipboard} className="w-4 h-4 shrink-0" />
            Go to Purchase Orders
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {scores.map(s => {
            const provisional = s.onTimeRate !== null && s.ratedCount < MIN_CONFIDENT_SAMPLE
            return (
              <div key={s.vendorId || s.vendorName} className="card p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    {/* Linked names now carry an icon. The only affordance was
                        hover:underline, so on a list of ten vendors you couldn't
                        tell which were navigable without hovering each one —
                        vendors recorded by name only have no record to open. */}
                    <p className="font-semibold text-white">
                      {s.vendorId ? (
                        <Link to={`/records/${s.vendorId}`} className="inline-flex items-center gap-1 hover:underline">
                          {s.vendorName}
                          <Icon d={ICONS.arrowRight} className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                        </Link>
                      ) : s.vendorName}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
                      {s.totalPOs} PO{s.totalPOs !== 1 ? 's' : ''} · {s.receivedCount} received
                      {s.draftCount > 0 && ` · ${s.draftCount} draft`}
                      {s.cancelledCount > 0 && ` · ${s.cancelledCount} cancelled`}
                    </p>
                  </div>
                  {/* Says what the figure covers. It excludes cancelled POs but
                      includes drafts, which was unstated while being the largest
                      number on the card. */}
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-white tabular-nums">{fmtCurrency(s.totalSpend)}</p>
                    <p className="text-xs text-gray-400">excl. cancelled</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-700/40">
                  {/* Both metrics state their own sample, because they're drawn
                      from different populations: on-time needs an expectedDate
                      *and* a receivedDate, lead time needs only a receivedDate.
                      "100%" from 1 PO used to sit beside "12d" from 20 with
                      nothing to say so. */}
                  <div>
                    <p className={`text-xs ${sortBy === 'onTime' ? 'text-indigo-300 font-medium' : 'text-gray-400'}`}>
                      On-Time Delivery{sortBy === 'onTime' && ' · sorted'}
                    </p>
                    <p className={`text-lg font-semibold tabular-nums ${rateColor(s.onTimeRate, s.ratedCount)}`}>
                      {s.onTimeRate !== null ? `${s.onTimeRate}%` : '—'}
                    </p>
                    <p className="text-xs text-gray-400 tabular-nums">
                      {s.ratedCount > 0
                        ? `${s.onTimeCount} of ${s.ratedCount} rated PO${s.ratedCount !== 1 ? 's' : ''}`
                        : 'No POs with an expected date'}
                    </p>
                    {provisional && (
                      <p className="flex items-center gap-1 text-xs text-gray-300 mt-0.5">
                        <Icon d={ICONS.warning} className="w-3 h-3 shrink-0" />
                        Provisional — under {MIN_CONFIDENT_SAMPLE} rated
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Avg Lead Time</p>
                    <p className="text-lg font-semibold text-gray-200 tabular-nums">
                      {s.avgLeadDays !== null ? `${s.avgLeadDays}d` : '—'}
                    </p>
                    <p className="text-xs text-gray-400 tabular-nums">
                      {s.leadSampleCount > 0
                        ? `order → received, ${s.leadSampleCount} PO${s.leadSampleCount !== 1 ? 's' : ''}`
                        : 'No received POs to measure'}
                    </p>
                    {s.invalidLeadCount > 0 && (
                      <p className="flex items-center gap-1 text-xs text-amber-400 mt-0.5">
                        <Icon d={ICONS.warning} className="w-3 h-3 shrink-0" />
                        {s.invalidLeadCount} received before ordered
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
