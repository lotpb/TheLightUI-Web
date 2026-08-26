import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { subscribeToPurchaseOrders } from '../../services/purchaseOrderService'
import { type PurchaseOrder, poTotal, fmtCurrency } from '../../models/purchaseOrder'

interface VendorScore {
  vendorId: string
  vendorName: string
  totalPOs: number
  receivedCount: number
  cancelledCount: number
  onTimeCount: number
  ratedCount: number       // received POs that had an expectedDate to judge against
  onTimeRate: number | null // null = not enough data
  avgLeadDays: number | null
  totalSpend: number
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function rateColor(rate: number | null): string {
  if (rate === null) return 'text-gray-500'
  if (rate >= 90) return 'text-green-400'
  if (rate >= 70) return 'text-yellow-400'
  return 'text-red-400'
}

export default function VendorScorecardsPage() {
  usePageTitle('Vendor Scorecards')

  const [pos, setPOs] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'spend' | 'onTime' | 'volume'>('spend')

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
      const rated     = received.filter(p => p.expectedDate && p.receivedDate)
      const onTime    = rated.filter(p => p.receivedDate! <= p.expectedDate!)
      const leadTimes = received
        .filter(p => p.receivedDate)
        .map(p => daysBetween(p.orderDate, p.receivedDate!))

      results.push({
        vendorId: vendorPOs[0].vendorId,
        vendorName: vendorPOs[0].vendorName || key,
        totalPOs: vendorPOs.length,
        receivedCount: received.length,
        cancelledCount: cancelled.length,
        onTimeCount: onTime.length,
        ratedCount: rated.length,
        onTimeRate: rated.length > 0 ? Math.round((onTime.length / rated.length) * 100) : null,
        avgLeadDays: leadTimes.length > 0 ? Math.round(leadTimes.reduce((s, d) => s + d, 0) / leadTimes.length) : null,
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

      <div className="flex items-center gap-3 flex-wrap mb-6">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">Vendor Scorecards</h1>
          <p className="text-sm text-gray-500 mt-0.5">On-time delivery, lead time &amp; spend, derived from Purchase Orders</p>
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="input-field text-sm py-1.5 w-44 shrink-0"
        >
          <option value="spend">Sort by Spend</option>
          <option value="onTime">Sort by On-Time Rate</option>
          <option value="volume">Sort by PO Volume</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : scores.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-400 font-medium">No purchase orders yet</p>
          <p className="text-sm text-gray-600 mt-1">Scorecards build up automatically as Purchase Orders are created and received.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {scores.map(s => (
            <div key={s.vendorId || s.vendorName} className="card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-white">
                    {s.vendorId ? <Link to={`/records/${s.vendorId}`} className="hover:underline">{s.vendorName}</Link> : s.vendorName}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.totalPOs} PO{s.totalPOs !== 1 ? 's' : ''} · {s.receivedCount} received
                    {s.cancelledCount > 0 && ` · ${s.cancelledCount} cancelled`}
                  </p>
                </div>
                <p className="text-lg font-bold text-white">{fmtCurrency(s.totalSpend)}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-700/40">
                <div>
                  <p className="text-xs text-gray-500">On-Time Delivery</p>
                  <p className={`text-lg font-semibold ${rateColor(s.onTimeRate)}`}>
                    {s.onTimeRate !== null ? `${s.onTimeRate}%` : '—'}
                  </p>
                  {s.ratedCount > 0 && (
                    <p className="text-xs text-gray-600">{s.onTimeCount}/{s.ratedCount} on time</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-500">Avg Lead Time</p>
                  <p className="text-lg font-semibold text-gray-200">
                    {s.avgLeadDays !== null ? `${s.avgLeadDays}d` : '—'}
                  </p>
                  <p className="text-xs text-gray-600">order → received</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
