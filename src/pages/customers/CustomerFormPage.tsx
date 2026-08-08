import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { getCustomer, createCustomer, updateCustomer } from '../../services/customerService'
import { emptyCustomer, type CustomerItem } from '../../models/customer'
import { usePickerStore, RATE_OPTIONS, CALLBACK_OPTIONS, CATEGORY_OPTIONS } from '../../stores/pickerStore'
import { useAuthStore } from '../../stores/authStore'

export default function CustomerFormPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isNew = !id || id === 'new'

  const [form, setForm] = useState<CustomerItem>(() => {
    const base = emptyCustomer()
    const cat = searchParams.get('category')
    if (cat) base.category = cat
    return base
  })
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const isVendor   = form.category.toLowerCase() === 'vendor'
  const isEmployee = form.category.toLowerCase() === 'employee'
  const isLead     = form.category.toLowerCase() === 'lead'
  const isCustomer = form.category.toLowerCase() === 'customer'
  const isLeadOrCustomer = isLead || isCustomer

  function set<K extends keyof CustomerItem>(field: K, value: CustomerItem[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
        <button onClick={() => navigate(-1)} className="text-indigo-400 hover:text-indigo-300 text-sm">
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
              <label className="form-label">{isVendor ? 'Vendor Name' : 'First Name'}</label>
              <input className="input-field" value={form.first} onChange={e => set('first', e.target.value)} placeholder={isVendor ? 'Company' : 'First'} />
            </div>
            {!isVendor && (
              <div>
                <label className="form-label">Last Name</label>
                <input className="input-field" value={form.lastname} onChange={e => set('lastname', e.target.value)} placeholder="Last" />
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
                <PickerInput label="Salesman" value={form.salesman} options={lists.salesman} onChange={v => set('salesman', v)} />
              )}
              <PickerInput label="Job Type" value={form.job} options={lists.job} onChange={v => set('job', v)} />
              <PickerInput label="Product" value={form.product} options={lists.product} onChange={v => set('product', v)} />
              {!isLead && (
                <PickerInput label="Contractor" value={form.contractor} options={lists.contractor} onChange={v => set('contractor', v)} />
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
              <PickerInput label="Advertiser" value={form.adNo} options={lists.advertiser} onChange={v => set('adNo', v)} />
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
  const listId = `dl-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div>
      <label className="form-label">{label}</label>
      <input
        className="input-field"
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '—'}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.filter(Boolean).map(o => <option key={o} value={o} />)}
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
