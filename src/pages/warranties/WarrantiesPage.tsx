import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useAuthStore } from '../../stores/authStore'
import { subscribeToCustomers } from '../../services/customerService'
import {
  subscribeToWarranties,
  addWarranty,
  updateWarranty,
  deleteWarranty,
} from '../../services/warrantyService'
import { isExpired, isExpiringSoon, type Warranty } from '../../models/warranty'
import { fullName, type CustomerItem } from '../../models/customer'

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function todayInput() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateToInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function statusBadge(w: Warranty) {
  if (!w.isActive) return { label: 'Inactive', cls: 'bg-gray-700/60 text-gray-400 border-gray-600/40' }
  if (isExpired(w))      return { label: 'Expired',       cls: 'bg-red-500/20    text-red-400    border-red-600/40' }
  if (isExpiringSoon(w)) return { label: 'Expiring Soon', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-600/40' }
  return { label: 'Active', cls: 'bg-green-500/20 text-green-400 border-green-600/40' }
}

const BLANK_FORM = {
  customerId:    '',
  customerName:  '',
  customerQuery: '',
  title:         '',
  provider:      '',
  startDate:     todayInput(),
  expirationDate: '',
  notes:         '',
}

type Filter = 'active' | 'expiringSoon' | 'expired' | 'inactive' | 'all'

export default function WarrantiesPage() {
  usePageTitle('Warranties')
  const user      = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)

  const [warranties, setWarranties] = useState<Warranty[]>([])
  const [customers,  setCustomers]  = useState<CustomerItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [filter,     setFilter]     = useState<Filter>('active')

  // Form state
  const [showForm,     setShowForm]     = useState(false)
  const [editWarranty,  setEditWarranty] = useState<Warranty | null>(null)
  const [form,          setForm]         = useState(BLANK_FORM)
  const [showCustList,  setShowCustList] = useState(false)
  const [saving,        setSaving]       = useState(false)
  const custRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    const unsub = subscribeToWarranties(
      items => { setWarranties(items); setLoading(false) },
      err   => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [user, companyId])

  useEffect(() => {
    if (!user) return
    const unsub = subscribeToCustomers(setCustomers, () => {})
    return unsub
  }, [user, companyId])

  const custSuggestions = useMemo(() => {
    const q = form.customerQuery.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [customers, form.customerQuery])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (custRef.current && !custRef.current.contains(e.target as Node))
        setShowCustList(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function openAdd() {
    setEditWarranty(null)
    setForm(BLANK_FORM)
    setShowForm(true)
  }

  function openEdit(w: Warranty) {
    setEditWarranty(w)
    setForm({
      customerId:     w.customerId,
      customerName:   w.customerName,
      customerQuery:  w.customerName,
      title:          w.title,
      provider:       w.provider,
      startDate:      dateToInput(w.startDate),
      expirationDate: dateToInput(w.expirationDate),
      notes:          w.notes,
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditWarranty(null)
    setForm(BLANK_FORM)
  }

  function setField<K extends keyof typeof BLANK_FORM>(k: K, v: typeof BLANK_FORM[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function selectCustomer(c: CustomerItem) {
    const name = fullName(c)
    setForm(f => ({ ...f, customerId: c.id, customerName: name, customerQuery: name }))
    setShowCustList(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.expirationDate || !form.customerId) return
    setSaving(true)
    const startDate = new Date(form.startDate)
    const expirationDate = new Date(form.expirationDate)
    try {
      if (editWarranty) {
        await updateWarranty(
          editWarranty.id, form.customerId, form.customerName.trim() || form.customerQuery.trim(),
          form.title.trim(), form.provider.trim(),
          startDate, expirationDate, form.notes.trim(), true,
        )
      } else {
        await addWarranty(
          form.customerId,
          form.customerName.trim() || form.customerQuery.trim(),
          form.title.trim(),
          form.provider.trim(),
          startDate,
          expirationDate,
          form.notes.trim(),
        )
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(w: Warranty) {
    await updateWarranty(w.id, w.customerId, w.customerName, w.title, w.provider, w.startDate, w.expirationDate, w.notes, false)
  }

  async function handleDelete(w: Warranty) {
    if (!confirm(`Delete "${w.title}"?`)) return
    await deleteWarranty(w.id)
  }

  const filtered = warranties.filter(w => {
    if (filter === 'all')          return true
    if (filter === 'inactive')     return !w.isActive
    if (filter === 'expired')      return w.isActive && isExpired(w)
    if (filter === 'expiringSoon') return w.isActive && isExpiringSoon(w)
    return w.isActive && !isExpired(w) && !isExpiringSoon(w)
  })

  const counts = {
    active:       warranties.filter(w => w.isActive && !isExpired(w) && !isExpiringSoon(w)).length,
    expiringSoon: warranties.filter(w => w.isActive && isExpiringSoon(w)).length,
    expired:      warranties.filter(w => w.isActive && isExpired(w)).length,
    inactive:     warranties.filter(w => !w.isActive).length,
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Warranties</h1>
          <p className="text-sm text-gray-400 mt-0.5">Coverage periods and expiration tracking</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <span className="text-lg leading-none">+</span>
          New Warranty
        </button>
      </div>

      {!loading && warranties.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          {([
            { key: 'active',       label: 'Active',        color: 'text-green-400',  count: counts.active },
            { key: 'expiringSoon', label: 'Expiring Soon',  color: 'text-yellow-400', count: counts.expiringSoon },
            { key: 'expired',      label: 'Expired',        color: 'text-red-400',    count: counts.expired },
            { key: 'inactive',     label: 'Inactive',       color: 'text-gray-400',   count: counts.inactive },
          ] as const).map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)}
              className={`card px-3 py-3 text-left transition-colors ${filter === s.key ? 'ring-1 ring-indigo-500/50' : 'hover:bg-gray-700/40'}`}>
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 mb-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">{editWarranty ? 'Edit Warranty' : 'New Warranty'}</span>
            <button type="button" onClick={closeForm} className="text-gray-500 hover:text-gray-300 text-xl leading-none">✕</button>
          </div>

          <div ref={custRef} className="relative">
            <label className="form-label">Customer</label>
            <input
              type="text"
              className="input-field"
              placeholder="Search customer…"
              value={form.customerQuery}
              onChange={e => { setField('customerQuery', e.target.value); setField('customerId', ''); setShowCustList(true) }}
              onFocus={() => setShowCustList(true)}
              autoComplete="off"
            />
            {showCustList && custSuggestions.length > 0 && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
                {custSuggestions.map(c => (
                  <button key={c.id} type="button"
                    onMouseDown={() => selectCustomer(c)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/60 text-left">
                    <div>
                      <p className="text-sm text-gray-100 font-medium">{fullName(c)}</p>
                      {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!form.customerId && form.customerQuery && (
              <p className="text-xs text-red-400 mt-1">Select a customer from the list — typing a name alone won't link it.</p>
            )}
          </div>

          <div>
            <label className="form-label">Warranty Title</label>
            <input type="text" className="input-field" placeholder="e.g. 30yr Shingle Warranty"
              value={form.title} onChange={e => setField('title', e.target.value)} required />
          </div>

          <div>
            <label className="form-label">Provider</label>
            <input type="text" className="input-field" placeholder="Manufacturer / underwriter"
              value={form.provider} onChange={e => setField('provider', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Start Date</label>
              <input type="date" className="input-field"
                value={form.startDate} onChange={e => setField('startDate', e.target.value)} required />
            </div>
            <div>
              <label className="form-label">Expiration Date</label>
              <input type="date" className="input-field"
                value={form.expirationDate} onChange={e => setField('expirationDate', e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea className="input-field resize-none" rows={2} placeholder="Coverage details…"
              value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeForm} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
            <button type="submit" disabled={saving || !form.customerId} className="btn-primary text-sm px-4 py-1.5">
              {saving ? 'Saving…' : editWarranty ? 'Save Changes' : 'Create Warranty'}
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-none">
        {(['active', 'expiringSoon', 'expired', 'all', 'inactive'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}>
            {f === 'expiringSoon' ? 'Expiring Soon' : f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'expiringSoon' && counts.expiringSoon > 0 ? ` (${counts.expiringSoon})` : ''}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card px-4 py-4 animate-pulse flex gap-4 items-start">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-700 rounded w-48" />
                <div className="h-3 bg-gray-700/60 rounded w-32" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="card px-4 py-12 text-center">
            <p className="text-gray-400">
              {filter === 'expiringSoon' ? 'No warranties expiring soon' :
               filter === 'expired'      ? 'No expired warranties' :
               filter === 'inactive'     ? 'No inactive warranties' :
               'No warranties yet — tap New Warranty to create one'}
            </p>
          </div>
        ) : (
          filtered.map(w => {
            const badge = statusBadge(w)
            return (
              <div key={w.id} className="card px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
                      {w.provider && (
                        <span className="text-xs px-2 py-0.5 rounded-full border border-indigo-600/40 bg-indigo-600/10 text-indigo-300">
                          {w.provider}
                        </span>
                      )}
                    </div>
                    <p className="text-base font-semibold text-gray-100 mt-1.5">{w.title}</p>
                    {w.customerName && (
                      <p className="text-sm text-indigo-400 mt-0.5">
                        {w.customerId
                          ? <Link to={`/records/${w.customerId}`} className="hover:underline">{w.customerName}</Link>
                          : w.customerName}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                      <span>Start: {fmtDate(w.startDate)}</span>
                      <span className={isExpired(w) && w.isActive ? 'text-red-400 font-medium' : isExpiringSoon(w) && w.isActive ? 'text-yellow-400 font-medium' : ''}>
                        Expires: {fmtDate(w.expirationDate)}
                      </span>
                      {w.lastReminderSentAt && <span>Reminded: {fmtDate(w.lastReminderSentAt)}</span>}
                    </div>
                    {w.notes && (
                      <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{w.notes}</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button onClick={() => openEdit(w)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600/60 text-gray-300 transition-colors">
                      Edit
                    </button>
                    {w.isActive ? (
                      <button onClick={() => handleDeactivate(w)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/40 hover:bg-gray-600/40 text-gray-500 transition-colors">
                        Deactivate
                      </button>
                    ) : (
                      <button onClick={() => handleDelete(w)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-800/30 text-red-400 transition-colors">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
