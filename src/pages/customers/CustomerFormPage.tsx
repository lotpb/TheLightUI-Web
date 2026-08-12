import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { getCustomer, createCustomer, updateCustomer, getAllCustomersOnce } from '../../services/customerService'
import { emptyCustomer, fullName, type CustomerItem } from '../../models/customer'
import { useDebounce } from '../../hooks/useDebounce'
import { usePickerStore, RATE_OPTIONS, CALLBACK_OPTIONS, CATEGORY_OPTIONS } from '../../stores/pickerStore'
import { useAuthStore } from '../../stores/authStore'
import { useNavBack } from '../../hooks/useNavBack'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import ConfirmModal from '../../components/ConfirmModal'

export default function CustomerFormPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const navBack  = useNavBack('/records')
  const isNew = !id || id === 'new'
  usePageTitle(isNew ? 'New Record' : 'Edit Record')

  const labels = usePickerStore(s => s.labels)
  const [form, setForm] = useState<CustomerItem>(() => {
    const base = emptyCustomer()
    const cat = searchParams.get('category')
    if (cat) base.category = cat
    return base
  })
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ first?: string; lastname?: string }>({})
  const [allCustomers, setAllCustomers] = useState<CustomerItem[]>([])

  const { lists, fetch: fetchPickers, loaded } = usePickerStore()
  const user = useAuthStore(s => s.user)

  useEffect(() => { if (!loaded) fetchPickers() }, [loaded, fetchPickers])

  useEffect(() => {
    if (isNew || !id) return
    getCustomer(id)
      .then(c => {
        if (c) setForm(c)
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load record.')
        setLoading(false)
      })
  }, [id, isNew])

  // Load all records once (new records only) for client-side duplicate check
  useEffect(() => {
    if (!isNew) return
    getAllCustomersOnce().then(setAllCustomers).catch(() => {})
  }, [isNew])

  const dFirst = useDebounce(form.first, 600)
  const dLast  = useDebounce(form.lastname, 600)
  const dPhone = useDebounce(form.phone, 600)
  const dEmail = useDebounce(form.email, 600)

  const duplicates = useMemo<CustomerItem[]>(() => {
    if (!isNew || allCustomers.length === 0) return []
    const phone = dPhone.replace(/\D/g, '')
    const email = dEmail.trim().toLowerCase()
    const first = dFirst.trim().toLowerCase()
    const last  = dLast.trim().toLowerCase()
    if (!first && !phone && !email) return []

    return allCustomers.filter(c => {
      const cPhone = c.phone.replace(/\D/g, '')
      if (phone.length >= 7 && cPhone.length >= 7 && cPhone === phone) return true
      if (email.includes('@') && c.email.trim().toLowerCase() === email) return true
      if (first && last) {
        const cf = c.first.trim().toLowerCase()
        const cl = c.lastname.trim().toLowerCase()
        if (cf === first && cl === last) return true
        if ((cf.includes(first) || first.includes(cf)) &&
            (cl.includes(last) || last.includes(cl)) &&
            cf.length > 1 && cl.length > 1) return true
      }
      return false
    })
  }, [isNew, allCustomers, dFirst, dLast, dPhone, dEmail])

  const isVendor   = form.category.toLowerCase() === 'vendor'
  const isEmployee = form.category.toLowerCase() === 'employee'
  const isLead     = form.category.toLowerCase() === 'lead'
  const isCustomer = form.category.toLowerCase() === 'customer'
  const isLeadOrCustomer = isLead || isCustomer

  const blocker = useUnsavedChanges(touched && !saving)

  function set<K extends keyof CustomerItem>(field: K, value: CustomerItem[K]) {
    setTouched(true)
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: { first?: string; lastname?: string } = {}
    if (!form.first.trim()) errs.first = isVendor ? 'Vendor name is required.' : 'First name is required.'
    if (!isVendor && !form.lastname.trim()) errs.lastname = 'Last name is required.'
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return }
    setFieldErrors({})
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        const newId = await createCustomer(form, user?.uid)
        navigate(`/records/${newId}`, { replace: true })
      } else {
        await updateCustomer(id!, form, user?.uid)
        navigate(`/records/${id}`, { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={navBack} className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← Cancel
        </button>
        <h1 className="text-xl font-bold text-white">{isNew ? 'New Record' : 'Edit Record'}</h1>
        <button
          form="customer-form"
          type="submit"
          disabled={saving}
          className="btn-primary text-sm px-4 py-1.5"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 mb-4">
          <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-2">
            ⚠ Possible duplicate{duplicates.length > 1 ? 's' : ''} found
          </p>
          <div className="space-y-1.5">
            {duplicates.slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-yellow-200 truncate">
                  {fullName(c)}
                  {c.phone ? <span className="text-yellow-400/70 ml-2 text-xs">{c.phone}</span> : null}
                  {c.city ? <span className="text-yellow-400/50 ml-1 text-xs">· {c.city}</span> : null}
                </span>
                <Link
                  to={`/records/${c.id}`}
                  className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 transition-colors"
                >
                  View →
                </Link>
              </div>
            ))}
          </div>
          <p className="text-yellow-500/60 text-xs mt-2">You can still save this record if it's not a duplicate.</p>
        </div>
      )}

      <form id="customer-form" onSubmit={handleSubmit} className="space-y-4">

        {/* Status + category */}
        <FormSection title="Status">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Category</label>
              <select className="select-field" value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{o || '—'}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Status</label>
              <select className="select-field" value={form.isActive ? '1' : '0'} onChange={e => set('isActive', e.target.value === '1')}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
          </div>
        </FormSection>

        {/* Name */}
        <FormSection title="Name">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">
                {isVendor ? 'Vendor Name' : 'First Name'}
                <span className="text-red-400 ml-0.5">*</span>
              </label>
              <input
                className={`input-field ${fieldErrors.first ? 'border-red-500 focus:ring-red-500/50' : ''}`}
                value={form.first}
                onChange={e => { set('first', e.target.value); if (fieldErrors.first) setFieldErrors(p => ({ ...p, first: undefined })) }}
                placeholder={isVendor ? 'Company' : 'First'}
              />
              {fieldErrors.first && <p className="text-red-400 text-xs mt-1">{fieldErrors.first}</p>}
            </div>
            {isVendor && (
              <div>
                <label className="form-label">Profession</label>
                <input
                  className="input-field"
                  value={form.lastname}
                  onChange={e => set('lastname', e.target.value)}
                  placeholder="Trade / profession"
                />
              </div>
            )}
            {!isVendor && (
              <div>
                <label className="form-label">
                  Last Name
                  <span className="text-red-400 ml-0.5">*</span>
                </label>
                <input
                  className={`input-field ${fieldErrors.lastname ? 'border-red-500 focus:ring-red-500/50' : ''}`}
                  value={form.lastname}
                  onChange={e => { set('lastname', e.target.value); if (fieldErrors.lastname) setFieldErrors(p => ({ ...p, lastname: undefined })) }}
                  placeholder="Last"
                />
                {fieldErrors.lastname && <p className="text-red-400 text-xs mt-1">{fieldErrors.lastname}</p>}
              </div>
            )}
            {isEmployee && (
              <div>
                <label className="form-label">Middle</label>
                <input className="input-field" value={form.callback} onChange={e => set('callback', e.target.value)} placeholder="Middle" />
              </div>
            )}
          </div>
          {!isEmployee && !isVendor && (
            <div className="mt-3">
              <label className="form-label">Spouse</label>
              <input className="input-field" value={form.spouse} onChange={e => set('spouse', e.target.value)} placeholder="Spouse name" />
            </div>
          )}
          {isVendor && (
            <div className="mt-3">
              <label className="form-label">Website</label>
              <input className="input-field" type="url" value={form.spouse} onChange={e => set('spouse', e.target.value)} placeholder="https://example.com" />
            </div>
          )}
        </FormSection>

        {/* Contact */}
        <FormSection title="Contact">
          <div className="space-y-3">
            <div>
              <label className="form-label">Phone</label>
              <input className="input-field" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 555-5555" />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input className="input-field" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com" />
            </div>
          </div>
        </FormSection>

        {/* Address */}
        <FormSection title="Address">
          <div className="space-y-3">
            <div>
              <label className="form-label">Street</label>
              <input className="input-field" value={form.street} onChange={e => set('street', e.target.value)} placeholder="123 Main St" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="form-label">City</label>
                <input className="input-field" value={form.city} onChange={e => set('city', e.target.value)} placeholder="City" />
              </div>
              <div>
                <label className="form-label">State</label>
                <input className="input-field" value={form.state} onChange={e => set('state', e.target.value)} placeholder="FL" maxLength={2} />
              </div>
              <div>
                <label className="form-label">ZIP</label>
                <input className="input-field" value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="33432" />
              </div>
            </div>
          </div>
        </FormSection>

        {/* Job info — Vendor has its own field set */}
        {isVendor ? (
          <FormSection title="Vendor Info">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Profession</label>
                <input
                  className="input-field"
                  value={form.lastname}
                  onChange={e => set('lastname', e.target.value)}
                  placeholder="Profession"
                />
              </div>
              <div>
                <label className="form-label">Manager</label>
                <input
                  className="input-field"
                  value={form.callback}
                  onChange={e => set('callback', e.target.value)}
                  placeholder="Manager name"
                />
              </div>
              <div>
                <label className="form-label">Callback</label>
                <div className="relative flex items-center">
                  {form.salesman.toLowerCase() === 'yes' && (
                    <svg className="absolute left-2.5 w-4 h-4 text-green-400 fill-current pointer-events-none z-10" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                  )}
                  <select
                    className="select-field"
                    style={{ paddingLeft: '2rem' }}
                    value={form.salesman}
                    onChange={e => set('salesman', e.target.value)}
                  >
                    <option value="">—</option>
                    {CALLBACK_OPTIONS.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <PickerSelect label="Rating" value={form.rate} options={RATE_OPTIONS} onChange={v => set('rate', v)} />
              </div>
            </div>
          </FormSection>
        ) : !isEmployee && (
          <FormSection title="Job">
            <div className="grid grid-cols-2 gap-3">
              {isLeadOrCustomer && (
                <PickerInput label={labels.salesman} value={form.salesman} options={lists.salesman} onChange={v => set('salesman', v)} />
              )}
              <PickerInput label={labels.job} value={form.job} options={lists.job} onChange={v => set('job', v)} />
              <PickerInput label={labels.product} value={form.product} options={lists.product} onChange={v => set('product', v)} />
              {!isLead && (
                <PickerInput label={labels.contractor} value={form.contractor} options={lists.contractor} onChange={v => set('contractor', v)} />
              )}
              <div>
                <label className="form-label">Amount ($)</label>
                <input
                  className="input-field"
                  type="number"
                  min="0"
                  value={form.amount || ''}
                  onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="form-label">Quantity</label>
                <input
                  className="input-field"
                  type="number"
                  min="0"
                  value={form.quantity || ''}
                  onChange={e => set('quantity', parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <PickerSelect label="Rating" value={form.rate} options={RATE_OPTIONS} onChange={v => set('rate', v)} />
              <div>
                <label className="form-label">Called</label>
                <div className="relative flex items-center">
                  {form.callback.toLowerCase() === 'yes' && (
                    <svg className="absolute left-2.5 w-4 h-4 text-green-400 fill-current pointer-events-none z-10" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                  )}
                  <select
                    className="select-field"
                    style={{ paddingLeft: '2rem' }}
                    value={form.callback}
                    onChange={e => set('callback', e.target.value)}
                  >
                    <option value="">—</option>
                    {CALLBACK_OPTIONS.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <PickerInput label={labels.advertiser} value={form.adNo} options={lists.advertiser} onChange={v => set('adNo', v)} />
            </div>
          </FormSection>
        )}

        {/* Employee Info */}
        {isEmployee && (
          <FormSection title="Employee Info">
            <div className="grid grid-cols-2 gap-3">
              <PickerSelect label="Rating" value={form.rate} options={RATE_OPTIONS} onChange={v => set('rate', v)} />
              <div>
                <label className="form-label">Department</label>
                <input className="input-field" value={form.adNo} onChange={e => set('adNo', e.target.value)} placeholder="Department" />
              </div>
            </div>
          </FormSection>
        )}

        {/* Dates */}
        <FormSection title="Dates">
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Created" value={form.creationDate} onChange={d => set('creationDate', d)} />
            {isLead && (
              <DateField label="Appt Date" value={form.startDate} onChange={d => set('startDate', d)} />
            )}
            {isEmployee && (
              <>
                <DateField label="Start Date" value={form.startDate} onChange={d => set('startDate', d)} />
                <DateField label="End Date" value={form.completionDate} onChange={d => set('completionDate', d)} />
              </>
            )}
            {isCustomer && (
              <DateField label="Start" value={form.startDate} onChange={d => set('startDate', d)} />
            )}
            {(isCustomer || isVendor) && (
              <DateField label="Complete" value={form.completionDate} onChange={d => set('completionDate', d)} />
            )}
            <div>
              <label className="form-label">Last Updated</label>
              <input
                className="input-field opacity-60 cursor-default"
                type="date"
                value={form.lastUpdateDate instanceof Date && !isNaN(form.lastUpdateDate.getTime()) ? form.lastUpdateDate.toISOString().split('T')[0] : ''}
                readOnly
              />
            </div>
          </div>
        </FormSection>

        {/* Personal section — hidden for Vendor; SSN/DL/Dept for Employee only */}
        {!isVendor && <FormSection title="Personal">
          <div className="grid grid-cols-2 gap-3">
            {isEmployee && (
              <>
                <div>
                  <label className="form-label">Social Security</label>
                  <input className="input-field" value={form.spouse} onChange={e => set('spouse', e.target.value)} placeholder="###-##-####" />
                </div>
                <div>
                  <label className="form-label">Driver License</label>
                  <input
                    className="input-field uppercase"
                    value={form.driverLicense}
                    onChange={e => set('driverLicense', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="License #"
                  />
                </div>
              </>
            )}
            <div>
              <label className="form-label">Birth Date</label>
              <input
                className="input-field"
                type="date"
                value={toISODate(form.birthDate)}
                onChange={e => set('birthDate', e.target.value)}
              />
            </div>
          </div>
        </FormSection>}

        {/* Comments */}
        <FormSection title="Comments">
          <textarea
            className="input-field resize-none"
            rows={4}
            value={form.comments}
            onChange={e => set('comments', e.target.value)}
            placeholder="Notes…"
          />
        </FormSection>

        <div className="pb-8" />
      </form>

      <ConfirmModal
        isOpen={blocker.state === 'blocked'}
        message="You have unsaved changes. Leave anyway?"
        confirmLabel="Leave"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function PickerSelect({
  label, value, options, onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="select-field" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {options.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function PickerInput({
  label, value, options, onChange, placeholder,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  const safeLabel = label ?? ''
  const listId = `dl-${safeLabel.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div>
      <label className="form-label">{safeLabel}</label>
      <input
        className="input-field"
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '—'}
        autoComplete="off"
      />
      <datalist id={listId}>
        {(options ?? []).filter(Boolean).map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  )
}

function toISODate(s: string): string {
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0]
}

function DateField({ label, value, onChange }: { label: string; value: Date; onChange: (d: Date) => void }) {
  const iso = value instanceof Date && !isNaN(value.getTime())
    ? value.toISOString().split('T')[0]
    : ''
  return (
    <div>
      <label className="form-label">{label}</label>
      <input
        className="input-field"
        type="date"
        value={iso}
        onChange={e => {
          const d = new Date(e.target.value + 'T00:00:00')
          if (!isNaN(d.getTime())) onChange(d)
        }}
      />
    </div>
  )
}
