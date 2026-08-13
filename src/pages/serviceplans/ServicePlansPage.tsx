import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useAuthStore } from '../../stores/authStore'
import { subscribeToCustomers } from '../../services/customerService'
import {
  subscribeToServicePlans,
  addServicePlan,
  updateServicePlan,
  completeServicePlan,
  deleteServicePlan,
} from '../../services/servicePlanService'
import {
  FREQUENCY_LABELS,
  type ServicePlan,
  type ServicePlanFrequency,
} from '../../models/servicePlan'
import { fullName, type CustomerItem } from '../../models/customer'

const FREQUENCIES: ServicePlanFrequency[] = ['weekly', 'monthly', 'quarterly', 'biannual', 'annual']

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isOverdue(plan: ServicePlan) {
  return plan.nextDate < new Date()
}

function statusBadge(plan: ServicePlan) {
  if (!plan.isActive) return { label: 'Inactive', cls: 'bg-gray-700/60 text-gray-400 border-gray-600/40' }
  if (isOverdue(plan))  return { label: 'Overdue',  cls: 'bg-red-500/20  text-red-400  border-red-600/40' }
  return { label: 'Active', cls: 'bg-green-500/20 text-green-400 border-green-600/40' }
}

const BLANK_FORM = {
  customerId:   '',
  customerName: '',
  customerQuery:'',
  title:        '',
  frequency:    'quarterly' as ServicePlanFrequency,
  nextDate:     '',
  notes:        '',
  salesman:     '',
}

type Filter = 'active' | 'overdue' | 'inactive' | 'all'

export default function ServicePlansPage() {
  usePageTitle('Service Plans')
  const user      = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)

  const [plans,     setPlans]     = useState<ServicePlan[]>([])
  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [filter,    setFilter]    = useState<Filter>('active')

  // Form state
  const [showForm,   setShowForm]   = useState(false)
  const [editPlan,   setEditPlan]   = useState<ServicePlan | null>(null)
  const [form,       setForm]       = useState(BLANK_FORM)
  const [showCustList, setShowCustList] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const custRef = useRef<HTMLDivElement>(null)

  // Subscribe to plans
  useEffect(() => {
    if (!user) { setLoading(false); return }
    const unsub = subscribeToServicePlans(
      items => { setPlans(items); setLoading(false) },
      err   => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [user, companyId])

  // Subscribe to customers for the picker
  useEffect(() => {
    if (!user) return
    const unsub = subscribeToCustomers(setCustomers, () => {})
    return unsub
  }, [user, companyId])

  // Customer suggestions
  const custSuggestions = useMemo(() => {
    const q = form.customerQuery.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [customers, form.customerQuery, showCustList])

  // Close customer dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (custRef.current && !custRef.current.contains(e.target as Node))
        setShowCustList(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function openAdd() {
    setEditPlan(null)
    setForm(BLANK_FORM)
    setShowForm(true)
  }

  function openEdit(plan: ServicePlan) {
    setEditPlan(plan)
    const d = plan.nextDate
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setForm({
      customerId:    plan.customerId,
      customerName:  plan.customerName,
      customerQuery: plan.customerName,
      title:         plan.title,
      frequency:     plan.frequency,
      nextDate:      iso,
      notes:         plan.notes,
      salesman:      plan.salesman,
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditPlan(null)
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
    if (!form.title.trim() || !form.nextDate) return
    setSaving(true)
    const nextDate = new Date(form.nextDate)
    try {
      if (editPlan) {
        await updateServicePlan(
          editPlan.id, form.title.trim(), form.frequency,
          nextDate, form.notes.trim(), form.salesman.trim(),
          true,
        )
      } else {
        await addServicePlan(
          form.customerId,
          form.customerName.trim() || form.customerQuery.trim(),
          form.title.trim(),
          form.frequency,
          nextDate,
          form.notes.trim(),
          form.salesman.trim(),
        )
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete(plan: ServicePlan) {
    await completeServicePlan(plan)
  }

  async function handleDeactivate(plan: ServicePlan) {
    await updateServicePlan(plan.id, plan.title, plan.frequency, plan.nextDate, plan.notes, plan.salesman, false)
  }

  async function handleDelete(plan: ServicePlan) {
    if (!confirm(`Delete "${plan.title}"?`)) return
    await deleteServicePlan(plan.id)
  }

  const filtered = plans.filter(p => {
    if (filter === 'all')      return true
    if (filter === 'inactive') return !p.isActive
    if (filter === 'overdue')  return p.isActive && isOverdue(p)
    return p.isActive
  })

  const counts = {
    active:   plans.filter(p => p.isActive && !isOverdue(p)).length,
    overdue:  plans.filter(p => p.isActive && isOverdue(p)).length,
    inactive: plans.filter(p => !p.isActive).length,
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Service Plans</h1>
          <p className="text-sm text-gray-400 mt-0.5">Recurring maintenance and service schedules</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <span className="text-lg leading-none">+</span>
          New Plan
        </button>
      </div>

      {/* Stats row */}
      {!loading && plans.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {([
            { key: 'active',   label: 'Active',   color: 'text-green-400', count: counts.active },
            { key: 'overdue',  label: 'Overdue',  color: 'text-red-400',   count: counts.overdue },
            { key: 'inactive', label: 'Inactive', color: 'text-gray-400',  count: counts.inactive },
          ] as const).map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)}
              className={`card px-4 py-3 text-left transition-colors ${filter === s.key ? 'ring-1 ring-indigo-500/50' : 'hover:bg-gray-700/40'}`}>
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Slide-in form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-5 mb-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">{editPlan ? 'Edit Plan' : 'New Service Plan'}</span>
            <button type="button" onClick={closeForm} className="text-gray-500 hover:text-gray-300 text-xl leading-none">✕</button>
          </div>

          {/* Customer picker */}
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
          </div>

          <div>
            <label className="form-label">Plan Title</label>
            <input type="text" className="input-field" placeholder="e.g. Quarterly AC Maintenance"
              value={form.title} onChange={e => setField('title', e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Frequency</label>
              <select className="input-field"
                value={form.frequency} onChange={e => setField('frequency', e.target.value as ServicePlanFrequency)}>
                {FREQUENCIES.map(f => (
                  <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Next Service Date</label>
              <input type="date" className="input-field"
                value={form.nextDate} onChange={e => setField('nextDate', e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="form-label">Assigned To</label>
            <input type="text" className="input-field" placeholder="Salesman / Technician"
              value={form.salesman} onChange={e => setField('salesman', e.target.value)} />
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea className="input-field resize-none" rows={2} placeholder="Service notes or scope…"
              value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeForm} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-1.5">
              {saving ? 'Saving…' : editPlan ? 'Save Changes' : 'Create Plan'}
            </button>
          </div>
        </form>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-none">
        {(['active', 'overdue', 'all', 'inactive'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
              filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}>
            {f}{f === 'overdue' && counts.overdue > 0 ? ` (${counts.overdue})` : ''}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
      )}

      {/* Plan list */}
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
              {filter === 'overdue' ? 'No overdue plans' :
               filter === 'inactive' ? 'No inactive plans' :
               'No service plans yet — tap New Plan to create one'}
            </p>
          </div>
        ) : (
          filtered.map(plan => {
            const badge = statusBadge(plan)
            return (
              <div key={plan.id} className="card px-4 py-4">
                <div className="flex items-start gap-3">
                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full border border-indigo-600/40 bg-indigo-600/10 text-indigo-300">
                        {FREQUENCY_LABELS[plan.frequency]}
                      </span>
                    </div>
                    <p className="text-base font-semibold text-gray-100 mt-1.5">{plan.title}</p>
                    {plan.customerName && (
                      <p className="text-sm text-indigo-400 mt-0.5">
                        {plan.customerId
                          ? <Link to={`/records/${plan.customerId}`} className="hover:underline">{plan.customerName}</Link>
                          : plan.customerName}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                      <span>
                        <span className={isOverdue(plan) && plan.isActive ? 'text-red-400 font-medium' : 'text-gray-300'}>
                          Next: {fmtDate(plan.nextDate)}
                        </span>
                      </span>
                      {plan.lastCompletedDate && (
                        <span>Last: {fmtDate(plan.lastCompletedDate)}</span>
                      )}
                      {plan.salesman && <span>Assigned: {plan.salesman}</span>}
                    </div>
                    {plan.notes && (
                      <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{plan.notes}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {plan.isActive && (
                      <button onClick={() => handleComplete(plan)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30 transition-colors whitespace-nowrap">
                        ✓ Complete
                      </button>
                    )}
                    <button onClick={() => openEdit(plan)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600/60 text-gray-300 transition-colors">
                      Edit
                    </button>
                    {plan.isActive ? (
                      <button onClick={() => handleDeactivate(plan)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/40 hover:bg-gray-600/40 text-gray-500 transition-colors">
                        Deactivate
                      </button>
                    ) : (
                      <button onClick={() => handleDelete(plan)}
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
