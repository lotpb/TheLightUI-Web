import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useCustomerDeepLink } from '../../hooks/useCustomerDeepLink'
import CustomerScopeBanner from '../../components/CustomerScopeBanner'
import PartialDataBanner from '../../components/PartialDataBanner'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import { useAuthStore } from '../../stores/authStore'
import { subscribeToCustomers } from '../../services/customerService'
import {
  subscribeToWarranties,
  addWarranty,
  updateWarranty,
  deleteWarranty,
} from '../../services/warrantyService'
import {
  EXPIRY_WINDOW_DAYS, daysUntilExpiration, filterWarranties, fmtWarrantyDate,
  isExpired, isExpiringSoon, warrantyCounts, warrantyDateToInput,
  warrantyFormError, warrantyStatusOf, warrantyTermWarning,
  WARRANTY_FILTERS, WARRANTY_STATUS_COLORS, WARRANTY_STATUS_LABELS,
  type Warranty, type WarrantyFilter, type WarrantyStatus,
} from '../../models/warranty'
import { fullName, type CustomerItem } from '../../models/customer'

function todayInput() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

/** How many customer suggestions the picker shows at once. */
const SUGGESTION_LIMIT = 8

export default function WarrantiesPage() {
  usePageTitle('Warranties')
  const toast     = useToast()
  const user      = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)

  const [warranties, setWarranties] = useState<Warranty[]>([])
  const [customers,  setCustomers]  = useState<CustomerItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  // Both listeners report a hitCap flag and both callers dropped it, so past
  // 5,000 records neither the list nor the customer picker said it was
  // showing a subset.
  const [hitCap,     setHitCap]     = useState(false)
  const [custHitCap, setCustHitCap] = useState(false)
  /**
   * Was 'active', which is defined as active AND NOT expiring soon — so the
   * landing view of an expiration tracker excluded exactly the warranties
   * needing action. 'open' is everything still in force, soonest first.
   */
  const [filter,     setFilter]     = useState<WarrantyFilter>('open')

  // Form state
  const [showForm,     setShowForm]     = useState(false)
  const [editWarranty, setEditWarranty] = useState<Warranty | null>(null)
  const [form,         setForm]         = useState(BLANK_FORM)
  const [submitted,    setSubmitted]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [confirmDel,   setConfirmDel]   = useState<Warranty | null>(null)

  // Customer picker
  const [showCustList, setShowCustList] = useState(false)
  const [activeIdx,    setActiveIdx]    = useState(-1)
  const custRef  = useRef<HTMLDivElement>(null)
  const listboxId = 'warranty-customer-list'

  useEffect(() => {
    if (!user) { setLoading(false); return }
    const unsub = subscribeToWarranties(
      (items, cap) => { setWarranties(items); setHitCap(!!cap); setLoading(false) },
      err          => { setError(err.message); setLoading(false) },
    )
    return unsub
  }, [user, companyId])

  useEffect(() => {
    if (!user) return
    const unsub = subscribeToCustomers(
      (items, cap) => { setCustomers(items); setCustHitCap(!!cap) },
      () => {},
    )
    return unsub
  }, [user, companyId])

  const custMatches = useMemo(() => {
    const q = form.customerQuery.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q)
    )
  }, [customers, form.customerQuery])

  const custSuggestions = useMemo(
    () => custMatches.slice(0, SUGGESTION_LIMIT),
    [custMatches],
  )

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (custRef.current && !custRef.current.contains(e.target as Node)) {
        setShowCustList(false)
        setActiveIdx(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Arriving from a customer's Related Records panel: scope the list to that
  // customer, and on `&new=1` open the form with the picker already filled in.
  const { customerId: scopeId, customerName: scopeName, isScoped, clearScope } =
    useCustomerDeepLink(customers, openAddFor)

  function openAdd() {
    setEditWarranty(null)
    setForm(BLANK_FORM)
    setSubmitted(false)
    setShowForm(true)
  }

  function openAddFor(c: CustomerItem) {
    const name = fullName(c)
    setEditWarranty(null)
    setForm({ ...BLANK_FORM, customerId: c.id, customerName: name, customerQuery: name })
    setSubmitted(false)
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
      startDate:      warrantyDateToInput(w.startDate),
      expirationDate: warrantyDateToInput(w.expirationDate),
      notes:          w.notes,
    })
    setSubmitted(false)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditWarranty(null)
    setForm(BLANK_FORM)
    setSubmitted(false)
    setShowCustList(false)
    setActiveIdx(-1)
  }

  function setField<K extends keyof typeof BLANK_FORM>(k: K, v: typeof BLANK_FORM[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function selectCustomer(c: CustomerItem) {
    const name = fullName(c)
    setForm(f => ({ ...f, customerId: c.id, customerName: name, customerQuery: name }))
    setShowCustList(false)
    setActiveIdx(-1)
  }

  /**
   * The suggestion list was mouse-only: buttons selected with onMouseDown, no
   * arrow keys, no combobox roles. Since submit is gated on a customerId that
   * only a click could set, the form could not be completed from the keyboard
   * at all.
   */
  function onCustKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!showCustList) { setShowCustList(true); setActiveIdx(0); return }
      const last = custSuggestions.length - 1
      if (last < 0) return
      setActiveIdx(i => {
        if (e.key === 'ArrowDown') return i >= last ? 0 : i + 1
        return i <= 0 ? last : i - 1
      })
      return
    }
    if (e.key === 'Enter') {
      const pick = custSuggestions[activeIdx]
      if (showCustList && pick) {
        e.preventDefault()   // don't submit the form on the same keystroke
        selectCustomer(pick)
      }
      return
    }
    if (e.key === 'Escape' && showCustList) {
      e.preventDefault()
      setShowCustList(false)
      setActiveIdx(-1)
    }
  }

  const formError   = warrantyFormError(form)
  const termWarning = warrantyTermWarning(form)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (formError) return

    setSaving(true)
    // Both dates are day-granular, so they're parsed as UTC midnight — the
    // same instant the rest of the app compares and renders them at.
    const startDate      = new Date(`${form.startDate}T00:00:00Z`)
    const expirationDate = new Date(`${form.expirationDate}T00:00:00Z`)
    const fields = {
      customerId:   form.customerId,
      customerName: form.customerName.trim() || form.customerQuery.trim(),
      title:        form.title.trim(),
      provider:     form.provider.trim(),
      startDate,
      expirationDate,
      notes:        form.notes.trim(),
    }
    try {
      if (editWarranty) {
        await updateWarranty(
          editWarranty.id,
          { ...fields, isActive: editWarranty.isActive },
          { previousExpiration: editWarranty.expirationDate },
        )
        toast('Warranty updated', 'success')
      } else {
        await addWarranty(fields)
        toast('Warranty created', 'success')
      }
      closeForm()
    } catch {
      // Was try/finally with no catch: a rejected write cleared the spinner,
      // left the form open and said nothing, so it read as a successful save.
      toast('Could not save the warranty — nothing was changed. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(w: Warranty) {
    try {
      await updateWarranty(w.id, {
        customerId: w.customerId, customerName: w.customerName,
        title: w.title, provider: w.provider,
        startDate: w.startDate, expirationDate: w.expirationDate,
        notes: w.notes, isActive: false,
      })
      toast(`“${w.title}” deactivated`, 'success')
    } catch {
      toast('Could not deactivate this warranty. Try again.', 'error')
    }
  }

  async function handleDelete(w: Warranty) {
    setConfirmDel(null)
    try {
      await deleteWarranty(w.id)
      toast('Warranty deleted', 'success')
    } catch {
      toast('Could not delete this warranty. Try again.', 'error')
    }
  }

  const scoped = isScoped ? warranties.filter(w => w.customerId === scopeId) : warranties

  // A scoped view shows every warranty this customer has, expired ones
  // included. Applying the status filter as well would let someone arrive from
  // a customer with only expired coverage and see an empty page.
  const filtered = isScoped ? scoped : filterWarranties(scoped, filter)
  const counts   = warrantyCounts(scoped)

  const activeFilterLabel = WARRANTY_FILTERS.find(f => f.key === filter)?.label ?? 'Open'

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Warranties</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Coverage periods and expiration tracking. Each customer is emailed once,
            {' '}{EXPIRY_WINDOW_DAYS} days before their warranty expires.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors shrink-0
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Icon d={ICONS.plus} className="w-4 h-4" />
          New Warranty
        </button>
      </div>

      {isScoped && (
        <CustomerScopeBanner customerId={scopeId} customerName={scopeName} onClear={clearScope} />
      )}

      {hitCap && (
        <PartialDataBanner detail="Warranties beyond the cap aren't listed here, so the counts below are understated." />
      )}

      {!isScoped && !loading && warranties.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {([
            { key: 'active',       label: 'Active',        color: 'text-green-400',  count: counts.active },
            { key: 'expiringSoon', label: 'Expiring Soon', color: 'text-yellow-400', count: counts.expiringSoon },
            { key: 'expired',      label: 'Expired',       color: 'text-red-400',    count: counts.expired },
            { key: 'inactive',     label: 'Inactive',      color: 'text-gray-300',   count: counts.inactive },
          ] as const).map(s => (
            <button
              key={s.key}
              onClick={() => setFilter(s.key)}
              aria-pressed={filter === s.key}
              /* The selected cue was ring-1 ring-indigo-500/50 — 1.80:1
                 against the card, while the pill row below showed the same
                 state in solid indigo. The big control had the faint cue. */
              className={`card px-3 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                filter === s.key
                  ? 'ring-2 ring-indigo-400 bg-indigo-500/15'
                  : 'hover:bg-gray-700/50'
              }`}
            >
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.count}</p>
              <p className="text-xs text-gray-300 mt-0.5">{s.label}</p>
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} noValidate className="card p-5 mb-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">{editWarranty ? 'Edit Warranty' : 'New Warranty'}</span>
            <button
              type="button"
              onClick={closeForm}
              aria-label="Close"
              className="p-1 -mr-1 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-700/60
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <Icon d={ICONS.close} className="w-5 h-5" />
            </button>
          </div>

          <div ref={custRef} className="relative">
            <label htmlFor="warranty-customer" className="form-label">Customer</label>
            <input
              id="warranty-customer"
              type="text"
              role="combobox"
              aria-expanded={showCustList && custSuggestions.length > 0}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeIdx >= 0 ? `warranty-cust-${activeIdx}` : undefined}
              className="input-field"
              placeholder="Search customer…"
              value={form.customerQuery}
              onChange={e => {
                setField('customerQuery', e.target.value)
                setField('customerId', '')
                setShowCustList(true)
                setActiveIdx(-1)
              }}
              onFocus={() => setShowCustList(true)}
              onKeyDown={onCustKeyDown}
              autoComplete="off"
            />
            {showCustList && custSuggestions.length > 0 && (
              <div
                id={listboxId}
                role="listbox"
                aria-label="Matching customers"
                className="absolute z-20 left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden"
              >
                {custSuggestions.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    id={`warranty-cust-${i}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    onMouseDown={() => selectCustomer(c)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${
                      i === activeIdx ? 'bg-indigo-500/30' : 'hover:bg-gray-700/60'
                    }`}
                  >
                    <div>
                      <p className="text-sm text-gray-100 font-medium">{fullName(c)}</p>
                      {c.phone && <p className="text-xs text-gray-300">{c.phone}</p>}
                    </div>
                  </button>
                ))}
                {/* The list is capped, and with an empty query it shows an
                    arbitrary eight — the customer listener applies its own cap
                    without an orderBy. Say so rather than implying these are
                    the only matches. */}
                {custMatches.length > SUGGESTION_LIMIT && (
                  <p className="px-4 py-2 text-xs text-gray-300 bg-gray-700/50 border-t border-gray-700">
                    Showing {SUGGESTION_LIMIT} of {custMatches.length.toLocaleString()} — keep typing to narrow it down.
                  </p>
                )}
              </div>
            )}
            {showCustList && form.customerQuery.trim() && custMatches.length === 0 && (
              <p className="text-xs text-gray-300 mt-1">
                No customer matches “{form.customerQuery.trim()}”.
              </p>
            )}
            {custHitCap && (
              <p className="text-xs text-yellow-300 mt-1">
                Your customer list is capped, so someone past the cap won’t appear here.
              </p>
            )}
            {!form.customerId && form.customerQuery && (
              <p className="text-xs text-red-400 mt-1">
                Select a customer from the list — typing a name alone won’t link it.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="warranty-title" className="form-label">Warranty Title</label>
            <input id="warranty-title" type="text" className="input-field" placeholder="e.g. 30yr Shingle Warranty"
              value={form.title} onChange={e => setField('title', e.target.value)} />
          </div>

          <div>
            <label htmlFor="warranty-provider" className="form-label">Provider</label>
            <input id="warranty-provider" type="text" className="input-field" placeholder="Manufacturer / underwriter"
              value={form.provider} onChange={e => setField('provider', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="warranty-start" className="form-label">Start Date</label>
              <input id="warranty-start" type="date" className="input-field"
                value={form.startDate} onChange={e => setField('startDate', e.target.value)} />
            </div>
            <div>
              <label htmlFor="warranty-expiry" className="form-label">Expiration Date</label>
              <input id="warranty-expiry" type="date" className="input-field"
                value={form.expirationDate} onChange={e => setField('expirationDate', e.target.value)} />
            </div>
          </div>

          <div>
            <label htmlFor="warranty-notes" className="form-label">Notes</label>
            <textarea id="warranty-notes" className="input-field resize-none" rows={2} placeholder="Coverage details…"
              value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>

          {/* Coverage ending before it starts used to save happily and then
              render as Expired with a start date in the future. */}
          {submitted && formError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/25 border border-red-700/50 rounded-lg px-3 py-2">
              <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </p>
          )}
          {!formError && termWarning && (
            <p className="flex items-start gap-2 text-sm text-amber-200 bg-amber-900/25 border border-amber-600/40 rounded-lg px-3 py-2">
              <Icon d={ICONS.warning} className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{termWarning}</span>
            </p>
          )}

          {/* Creating a warranty enrols this customer in outbound mail. That
              was never stated anywhere on the page. */}
          <p className="text-xs text-gray-300">
            {form.customerName || 'This customer'} will be emailed once, automatically,
            {' '}{EXPIRY_WINDOW_DAYS} days before the expiration date.
            {editWarranty?.lastReminderSentAt && (
              <> Changing the expiration date re-arms that reminder.</>
            )}
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeForm} className="btn-secondary text-sm px-4 py-1.5">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40">
              {saving ? 'Saving…' : editWarranty ? 'Save Changes' : 'Create Warranty'}
            </button>
          </div>
        </form>
      )}

      {!isScoped && (
        <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-none" role="group" aria-label="Filter warranties">
          {WARRANTY_FILTERS.map(f => {
            const n = counts[f.key]
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                {f.label}{n > 0 ? ` (${n})` : ''}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">{error}</div>
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
            <p className="text-gray-300">
              {isScoped
                ? 'No warranties for this customer yet'
                : warranties.length === 0
                  ? 'No warranties yet — tap New Warranty to create one'
                  : `No warranties in ${activeFilterLabel}.`}
            </p>
            {!isScoped && warranties.length > 0 && filter !== 'all' && (
              <button
                onClick={() => setFilter('all')}
                className="text-sm text-indigo-400 hover:text-indigo-300 mt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1"
              >
                Show all {counts.all.toLocaleString()}
              </button>
            )}
          </div>
        ) : (
          filtered.map(w => {
            const status: WarrantyStatus = warrantyStatusOf(w)
            const days = daysUntilExpiration(w)
            return (
              <div key={w.id} className="card px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${WARRANTY_STATUS_COLORS[status]}`}>
                        {WARRANTY_STATUS_LABELS[status]}
                      </span>
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
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
                      <span>Start: {fmtWarrantyDate(w.startDate)}</span>
                      <span className={isExpired(w) && w.isActive ? 'text-red-400 font-medium' : isExpiringSoon(w) && w.isActive ? 'text-yellow-400 font-medium' : ''}>
                        Expires: {fmtWarrantyDate(w.expirationDate)}
                        {w.isActive && (
                          days === 0 ? ' (today)'
                            : days > 0 && days <= EXPIRY_WINDOW_DAYS ? ` (in ${days} day${days !== 1 ? 's' : ''})`
                            : days < 0 ? ` (${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago)`
                            : ''
                        )}
                      </span>
                      {/* Was "Reminded:", which reads like an internal log
                          entry. It means an email went to the customer. */}
                      {w.lastReminderSentAt && (
                        <span>Customer emailed: {fmtWarrantyDate(w.lastReminderSentAt)}</span>
                      )}
                    </div>
                    {w.notes && (
                      <p className="text-xs text-gray-300 mt-1.5 line-clamp-2">{w.notes}</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(w)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600/60 text-gray-200 transition-colors
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    >
                      Edit
                    </button>
                    {w.isActive ? (
                      /* Was text-gray-500 on bg-gray-700/40 — 2.64:1, the
                         least legible control on the page, and the one that
                         changes a record's lifecycle state. Edit beside it
                         was 8.15:1. */
                      <button
                        onClick={() => handleDeactivate(w)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-600/60 text-gray-200 transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirmDel(w)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-800/30 text-red-400 transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
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

      {/* Was window.confirm — an OS dialog captioned "localhost:5173 says",
          outside the design system, naming only the title. */}
      <ConfirmModal
        isOpen={!!confirmDel}
        confirmLabel="Delete warranty"
        message={confirmDel
          ? `Delete “${confirmDel.title}” for ${confirmDel.customerName || 'this customer'}? Its coverage dates and reminder history go with it. This cannot be undone.`
          : ''}
        onConfirm={() => confirmDel && handleDelete(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  )
}
