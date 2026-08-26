import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import ConfirmModal from '../../components/ConfirmModal'
import { subscribeToCustomers } from '../../services/customerService'
import {
  subscribeToPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder,
} from '../../services/purchaseOrderService'
import {
  type PurchaseOrder, type PurchaseOrderLineItem, type PurchaseOrderStatus,
  STATUS_LABELS, STATUS_COLORS, poTotal, lineItemTotal, fmtCurrency,
} from '../../models/purchaseOrder'
import { fullName, categoryMatches, type CustomerItem } from '../../models/customer'

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyLineItem(): PurchaseOrderLineItem {
  return { description: '', qty: 1, unitCost: 0 }
}

const BLANK_FORM = {
  vendorId: '', vendorName: '', vendorQuery: '',
  jobId: '', jobName: '', jobQuery: '',
  notes: '',
  orderDate: toISO(new Date()),
  expectedDate: '',
}

type Filter = 'active' | PurchaseOrderStatus | 'all'

function useClickOutside(ref: React.RefObject<HTMLElement>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [active, ref, onClose])
}

export default function PurchaseOrdersPage() {
  usePageTitle('Purchase Orders')
  const toast = useToast()

  const [pos, setPOs] = useState<PurchaseOrder[]>([])
  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('active')

  const [showForm, setShowForm] = useState(false)
  const [editPO, setEditPO] = useState<PurchaseOrder | null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [lineItems, setLineItems] = useState<PurchaseOrderLineItem[]>([emptyLineItem()])
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrder | null>(null)

  const [showVendorList, setShowVendorList] = useState(false)
  const [showJobList, setShowJobList] = useState(false)
  const vendorRef = useRef<HTMLDivElement>(null)
  const jobRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeToPurchaseOrders(
    items => { setPOs(items); setLoading(false) },
    () => setLoading(false),
  ), [])

  useEffect(() => subscribeToCustomers(setCustomers, () => {}), [])

  useClickOutside(vendorRef, () => setShowVendorList(false), showVendorList)
  useClickOutside(jobRef, () => setShowJobList(false), showJobList)

  const vendors = useMemo(() => customers.filter(c => categoryMatches(c.category, 'Vendor')), [customers])
  const jobCandidates = useMemo(() => customers.filter(c =>
    categoryMatches(c.category, 'Customer') || categoryMatches(c.category, 'Lead')
  ), [customers])

  const vendorSuggestions = useMemo(() => {
    const q = form.vendorQuery.trim().toLowerCase()
    if (!q) return vendors.slice(0, 8)
    return vendors.filter(v => fullName(v).toLowerCase().includes(q)).slice(0, 8)
  }, [vendors, form.vendorQuery])

  const jobSuggestions = useMemo(() => {
    const q = form.jobQuery.trim().toLowerCase()
    if (!q) return jobCandidates.slice(0, 8)
    return jobCandidates.filter(c =>
      fullName(c).toLowerCase().includes(q) || c.job.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [jobCandidates, form.jobQuery])

  function setField<K extends keyof typeof BLANK_FORM>(k: K, v: typeof BLANK_FORM[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function selectVendor(v: CustomerItem) {
    const name = fullName(v)
    setForm(f => ({ ...f, vendorId: v.id, vendorName: name, vendorQuery: name }))
    setShowVendorList(false)
  }

  function selectJob(c: CustomerItem) {
    const label = c.job ? `${fullName(c)} — ${c.job}` : fullName(c)
    setForm(f => ({ ...f, jobId: c.id, jobName: label, jobQuery: label }))
    setShowJobList(false)
  }

  function openAdd() {
    setEditPO(null)
    setForm(BLANK_FORM)
    setLineItems([emptyLineItem()])
    setShowForm(true)
  }

  function openEdit(po: PurchaseOrder) {
    setEditPO(po)
    setForm({
      vendorId: po.vendorId, vendorName: po.vendorName, vendorQuery: po.vendorName,
      jobId: po.jobId, jobName: po.jobName, jobQuery: po.jobName,
      notes: po.notes,
      orderDate: toISO(po.orderDate),
      expectedDate: po.expectedDate ? toISO(po.expectedDate) : '',
    })
    setLineItems(po.lineItems.length > 0 ? po.lineItems : [emptyLineItem()])
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditPO(null)
  }

  function updateLineItem(i: number, patch: Partial<PurchaseOrderLineItem>) {
    setLineItems(prev => prev.map((li, idx) => idx === i ? { ...li, ...patch } : li))
  }
  function addLineItem() {
    setLineItems(prev => [...prev, emptyLineItem()])
  }
  function removeLineItem(i: number) {
    setLineItems(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.vendorName.trim() || !form.orderDate) return
    setSaving(true)
    try {
      const cleanItems = lineItems.filter(li => li.description.trim())
      const fields = {
        vendorId: form.vendorId,
        vendorName: form.vendorName.trim() || form.vendorQuery.trim(),
        jobId: form.jobId,
        jobName: form.jobName.trim() || form.jobQuery.trim(),
        lineItems: cleanItems,
        notes: form.notes.trim(),
        orderDate: new Date(form.orderDate),
        expectedDate: form.expectedDate ? new Date(form.expectedDate) : null,
      }
      if (editPO) {
        await updatePurchaseOrder(editPO.id, fields)
      } else {
        await createPurchaseOrder(fields)
      }
      closeForm()
    } catch {
      toast('Failed to save purchase order', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(po: PurchaseOrder, status: PurchaseOrderStatus) {
    await updatePurchaseOrder(po.id, { status })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deletePurchaseOrder(deleteTarget.id)
    setDeleteTarget(null)
  }

  const filtered = pos.filter(po => {
    if (filter === 'all') return true
    if (filter === 'active') return po.status === 'draft' || po.status === 'sent'
    return po.status === filter
  })

  const counts = {
    active:    pos.filter(p => p.status === 'draft' || p.status === 'sent').length,
    received:  pos.filter(p => p.status === 'received').length,
    cancelled: pos.filter(p => p.status === 'cancelled').length,
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track material/service orders placed with vendors</p>
        </div>
        <button onClick={openAdd} className="btn-primary text-sm px-4 py-2 shrink-0">+ New PO</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {([
          { key: 'active', label: 'Active', color: 'text-blue-400', count: counts.active },
          { key: 'received', label: 'Received', color: 'text-green-400', count: counts.received },
          { key: 'cancelled', label: 'Cancelled', color: 'text-red-400', count: counts.cancelled },
        ] as const).map(s => (
          <button key={s.key} onClick={() => setFilter(s.key)}
            className={`card px-4 py-3 text-left transition-colors ${filter === s.key ? 'ring-1 ring-indigo-500/50' : 'hover:bg-gray-700/40'}`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 mb-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">{editPO ? `Edit ${editPO.poNumber}` : 'New Purchase Order'}</span>
            <button type="button" onClick={closeForm} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
          </div>

          {/* Vendor picker */}
          <div ref={vendorRef} className="relative">
            <label className="form-label">Vendor *</label>
            <input
              type="text" className="input-field" placeholder="Search vendors…"
              value={form.vendorQuery}
              onChange={e => { setField('vendorQuery', e.target.value); setField('vendorId', ''); setShowVendorList(true) }}
              onFocus={() => setShowVendorList(true)}
              autoComplete="off" required
            />
            {showVendorList && vendorSuggestions.length > 0 && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                {vendorSuggestions.map(v => (
                  <button key={v.id} type="button" onMouseDown={() => selectVendor(v)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-700/60">
                    <p className="text-sm text-gray-100 font-medium">{fullName(v)}</p>
                    {v.phone && <p className="text-xs text-gray-400">{v.phone}</p>}
                  </button>
                ))}
              </div>
            )}
            {vendors.length === 0 && (
              <p className="text-xs text-gray-600 mt-1">No vendor records yet — add one under Vendors first, or type a name freely above.</p>
            )}
          </div>

          {/* Job picker (optional) */}
          <div ref={jobRef} className="relative">
            <label className="form-label">Job / Customer (optional)</label>
            <input
              type="text" className="input-field" placeholder="Link to a customer job…"
              value={form.jobQuery}
              onChange={e => { setField('jobQuery', e.target.value); setField('jobId', ''); setShowJobList(true) }}
              onFocus={() => setShowJobList(true)}
              autoComplete="off"
            />
            {showJobList && jobSuggestions.length > 0 && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                {jobSuggestions.map(c => (
                  <button key={c.id} type="button" onMouseDown={() => selectJob(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-700/60">
                    <p className="text-sm text-gray-100 font-medium">{fullName(c)}</p>
                    {c.job && <p className="text-xs text-gray-400">{c.job}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Order Date</label>
              <input type="date" className="input-field" value={form.orderDate}
                onChange={e => setField('orderDate', e.target.value)} required />
            </div>
            <div>
              <label className="form-label">Expected Delivery</label>
              <input type="date" className="input-field" value={form.expectedDate}
                onChange={e => setField('expectedDate', e.target.value)} />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="form-label mb-0">Line Items</label>
              <button type="button" onClick={addLineItem} className="text-xs text-indigo-400 hover:text-indigo-300">+ Add item</button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    className="input-field flex-1 text-sm" placeholder="Description"
                    value={li.description} onChange={e => updateLineItem(i, { description: e.target.value })}
                  />
                  <input
                    type="number" min={0} className="input-field w-16 text-sm" placeholder="Qty"
                    value={li.qty} onChange={e => updateLineItem(i, { qty: Number(e.target.value) })}
                  />
                  <input
                    type="number" min={0} step="0.01" className="input-field w-24 text-sm" placeholder="Unit $"
                    value={li.unitCost} onChange={e => updateLineItem(i, { unitCost: Number(e.target.value) })}
                  />
                  <span className="text-sm text-gray-400 w-20 text-right shrink-0">{fmtCurrency(lineItemTotal(li))}</span>
                  {lineItems.length > 1 && (
                    <button type="button" onClick={() => removeLineItem(i)} className="text-gray-500 hover:text-red-400 shrink-0">×</button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-right text-sm font-semibold text-white mt-2">
              Total: {fmtCurrency(lineItems.reduce((s, li) => s + lineItemTotal(li), 0))}
            </p>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea className="input-field resize-none" rows={2} placeholder="Delivery instructions, PO terms, etc."
              value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeForm} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-1.5">
              {saving ? 'Saving…' : editPO ? 'Save Changes' : 'Create PO'}
            </button>
          </div>
        </form>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-none">
        {(['active', 'draft', 'sent', 'received', 'cancelled', 'all'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
              filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}>
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="card px-4 py-12 text-center">
            <p className="text-gray-400">No purchase orders here — tap New PO to create one.</p>
          </div>
        ) : (
          filtered.map(po => (
            <div key={po.id} className="card px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[po.status]}`}>{STATUS_LABELS[po.status]}</span>
                    <span className="text-xs text-gray-500 font-mono">{po.poNumber}</span>
                  </div>
                  <p className="text-base font-semibold text-gray-100 mt-1.5">
                    {po.vendorId ? <Link to={`/records/${po.vendorId}`} className="hover:underline">{po.vendorName}</Link> : po.vendorName}
                  </p>
                  {po.jobName && (
                    <p className="text-sm text-indigo-400 mt-0.5">
                      {po.jobId ? <Link to={`/records/${po.jobId}`} className="hover:underline">{po.jobName}</Link> : po.jobName}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                    <span>Ordered: {fmtDate(po.orderDate)}</span>
                    {po.expectedDate && <span>Expected: {fmtDate(po.expectedDate)}</span>}
                    {po.receivedDate && <span>Received: {fmtDate(po.receivedDate)}</span>}
                    <span className="font-medium text-gray-300">{fmtCurrency(poTotal(po))}</span>
                  </div>
                  {po.lineItems.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">
                      {po.lineItems.map(li => `${li.qty}× ${li.description}`).join(', ')}
                    </p>
                  )}
                  {po.lastEditedByName && (
                    <p className="text-xs text-gray-600 mt-1.5">Last edited by {po.lastEditedByName}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  {po.status === 'draft' && (
                    <button onClick={() => handleStatusChange(po, 'sent')}
                      className="text-xs px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/30 transition-colors whitespace-nowrap">
                      Mark Sent
                    </button>
                  )}
                  {po.status === 'sent' && (
                    <button onClick={() => handleStatusChange(po, 'received')}
                      className="text-xs px-3 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30 transition-colors whitespace-nowrap">
                      ✓ Received
                    </button>
                  )}
                  {(po.status === 'draft' || po.status === 'sent') && (
                    <button onClick={() => handleStatusChange(po, 'cancelled')}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-red-600/20 text-gray-400 hover:text-red-400 transition-colors whitespace-nowrap">
                      Cancel
                    </button>
                  )}
                  <button onClick={() => openEdit(po)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600/60 text-gray-300 transition-colors">
                    Edit
                  </button>
                  <button onClick={() => setDeleteTarget(po)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-red-600/20 text-gray-400 hover:text-red-400 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        message={deleteTarget ? `Delete purchase order ${deleteTarget.poNumber}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
