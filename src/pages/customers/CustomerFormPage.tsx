import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { getCustomer, createCustomer, updateCustomer, getAllCustomersOnce } from '../../services/customerService'
import { subscribeToCustomFieldDefs } from '../../services/customFieldService'
import { fetchSalesmenForCompany, memberDisplayName, type TeamMember } from '../../services/teamService'
import { emptyCustomer, fullName, type CustomerItem } from '../../models/customer'
import type { CustomFieldDef } from '../../models/customField'
import { useDebounce } from '../../hooks/useDebounce'
import { usePickerStore, RATE_OPTIONS, CALLBACK_OPTIONS, CATEGORY_OPTIONS } from '../../stores/pickerStore'
import { useAuthStore } from '../../stores/authStore'
import { useNavBack } from '../../hooks/useNavBack'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { usePermissions } from '../../hooks/usePermissions'
import ConfirmModal from '../../components/ConfirmModal'
import { validateCustomerForm, type CustomerFieldErrors } from '../../validation/customerFormSchema'


export default function CustomerFormPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const navBack  = useNavBack('/records')
  const isNew = !id || id === 'new'
  usePageTitle(isNew ? 'New Record' : 'Edit Record')

  const { isReadOnly } = usePermissions()
  const labels = usePickerStore(s => s.labels)

  // Viewers cannot create or edit records
  useEffect(() => {
    if (isReadOnly) navigate('/leads', { replace: true })
  }, [isReadOnly, navigate])

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
  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({})
  const [allCustomers, setAllCustomers] = useState<CustomerItem[]>([])
  const [linkedUser, setLinkedUser] = useState<{ role: string; lastSeen: Date | null } | null>(null)
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'linked' | 'not-found' | 'no-email'>('idle')

  const { lists, fetch: fetchPickers, loaded } = usePickerStore()
  const user = useAuthStore(s => s.user)
  const companyId = useAuthStore(s => s.companyId)

  useEffect(() => { if (!loaded) fetchPickers() }, [loaded, fetchPickers])

  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([])
  useEffect(() => subscribeToCustomFieldDefs(setCustomFieldDefs, () => {}), [])

  function setCustomFieldValue(key: string, value: string) {
    setForm(f => ({ ...f, customFields: { ...f.customFields, [key]: value } }))
  }

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

  // Look up the matching Firebase user by email for Employee records
  useEffect(() => {
    if (!isEmployee) { setLinkedUser(null); setLookupStatus('idle'); return }
    if (!dEmail) { setLinkedUser(null); setLookupStatus('no-email'); return }
    if (!companyId) { setLinkedUser(null); setLookupStatus('idle'); return }
    setLookupStatus('loading')
    const emailLower = dEmail.trim().toLowerCase()
    const q = query(collection(db, 'users'), where('companyId', '==', companyId))
    getDocs(q)
      .then(snap => {
        const match = snap.docs.find(d => {
          const e = d.data()['email']
          return typeof e === 'string' && e.toLowerCase() === emailLower
        })
        if (match) {
          const data = match.data()
          const role = typeof data['role'] === 'string' ? data['role'] : ''
          const lastSeen = data['lastSeen']?.toDate?.() ?? null
          setLinkedUser({ role, lastSeen })
          setLookupStatus('linked')
        } else {
          setLinkedUser(null)
          setLookupStatus('not-found')
        }
      })
      .catch(() => { setLinkedUser(null); setLookupStatus('not-found') })
  }, [isEmployee, dEmail, companyId])

  // Silently sync Firebase user data into form so it persists on save
  useEffect(() => {
    if (!linkedUser) return
    const lastLoginISO = linkedUser.lastSeen
      ? linkedUser.lastSeen.toISOString().split('T')[0]
      : ''
    setForm(prev => ({
      ...prev,
      userRole: linkedUser.role || prev.userRole,
      lastLogin: lastLoginISO || prev.lastLogin,
    }))
  }, [linkedUser])

  const blocker = useUnsavedChanges(touched && !saving)

  function set<K extends keyof CustomerItem>(field: K, value: CustomerItem[K]) {
    setTouched(true)
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateCustomerForm(form)
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
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody><tr>
            <td style={{ width: '50%', paddingRight: '6px', verticalAlign: 'top' }}>
              <label className="form-label">Category</label>
              <select className="select-field" value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORY_OPTIONS.map(o => <option key={o} value={o}>{o || '—'}</option>)}
              </select>
            </td>
            <td style={{ width: '50%', paddingLeft: '6px', verticalAlign: 'top' }}>
              <label className="form-label">Status</label>
              <select className="select-field" value={form.isActive ? '1' : '0'} onChange={e => set('isActive', e.target.value === '1')}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </td>
          </tr></tbody></table>
        </FormSection>

        {/* Name */}
        <FormSection title="Name">
          {isVendor ? (
            <div>
              <div>
                <label className="form-label">Vendor Name<span className="text-red-400 ml-0.5">*</span></label>
                <input
                  className={`input-field ${fieldErrors.first ? 'border-red-500 focus:ring-red-500/50' : ''}`}
                  value={form.first}
                  onChange={e => { set('first', e.target.value); if (fieldErrors.first) setFieldErrors(p => ({ ...p, first: undefined })) }}
                  placeholder="Company"
                />
                {fieldErrors.first && <p className="text-red-400 text-xs mt-1">{fieldErrors.first}</p>}
              </div>
              <div className="mt-3">
                <label className="form-label">Website</label>
                <input className="input-field" type="url" value={form.spouse} onChange={e => set('spouse', e.target.value)} placeholder="https://example.com" />
              </div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: isEmployee ? '12px' : 0, verticalAlign: 'top' }}>
                  <label className="form-label">First Name<span className="text-red-400 ml-0.5">*</span></label>
                  <input
                    className={`input-field ${fieldErrors.first ? 'border-red-500 focus:ring-red-500/50' : ''}`}
                    value={form.first}
                    onChange={e => { set('first', e.target.value); if (fieldErrors.first) setFieldErrors(p => ({ ...p, first: undefined })) }}
                    placeholder="First"
                  />
                  {fieldErrors.first && <p className="text-red-400 text-xs mt-1">{fieldErrors.first}</p>}
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: isEmployee ? '12px' : 0, verticalAlign: 'top' }}>
                  <label className="form-label">Last Name<span className="text-red-400 ml-0.5">*</span></label>
                  <input
                    className={`input-field ${fieldErrors.lastname ? 'border-red-500 focus:ring-red-500/50' : ''}`}
                    value={form.lastname}
                    onChange={e => { set('lastname', e.target.value); if (fieldErrors.lastname) setFieldErrors(p => ({ ...p, lastname: undefined })) }}
                    placeholder="Last"
                  />
                  {fieldErrors.lastname && <p className="text-red-400 text-xs mt-1">{fieldErrors.lastname}</p>}
                </td>
              </tr>
              {isEmployee && (
                <tr>
                  <td style={{ width: '50%', paddingRight: '6px', verticalAlign: 'top' }}>
                    <label className="form-label">Middle</label>
                    <input className="input-field" value={form.callback} onChange={e => set('callback', e.target.value)} placeholder="Middle" />
                  </td>
                  <td style={{ width: '50%', paddingLeft: '6px', verticalAlign: 'top' }} />
                </tr>
              )}
              {isCustomer && (
                <tr>
                  <td colSpan={2} style={{ paddingTop: '12px', verticalAlign: 'top' }}>
                    <label className="form-label">Company Name</label>
                    <input className="input-field" value={form.companyName} onChange={e => set('companyName', e.target.value)} placeholder="Company" />
                  </td>
                </tr>
              )}
            </tbody></table>
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
              <input
                className={`input-field ${fieldErrors.email ? 'border-red-500 focus:ring-red-500/50' : ''}`}
                type="email"
                value={form.email}
                onChange={e => { set('email', e.target.value); if (fieldErrors.email) setFieldErrors(p => ({ ...p, email: undefined })) }}
                placeholder="email@example.com"
              />
              {fieldErrors.email && <p className="text-red-400 text-xs mt-1">{fieldErrors.email}</p>}
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
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody><tr>
              <td style={{ width: '33.333%', paddingRight: '6px', verticalAlign: 'top' }}>
                <label className="form-label">City</label>
                <input className="input-field" value={form.city} onChange={e => set('city', e.target.value)} placeholder="City" />
              </td>
              <td style={{ width: '33.333%', paddingLeft: '6px', paddingRight: '6px', verticalAlign: 'top' }}>
                <label className="form-label">State</label>
                <input className="input-field" value={form.state} onChange={e => set('state', e.target.value)} placeholder="FL" maxLength={2} />
              </td>
              <td style={{ width: '33.333%', paddingLeft: '6px', verticalAlign: 'top' }}>
                <label className="form-label">ZIP</label>
                <input className="input-field" value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="33432" />
              </td>
            </tr></tbody></table>
          </div>
        </FormSection>

        {/* Job info — Vendor has its own field set */}
        {isVendor ? (
          <FormSection title="Vendor Info">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              <tr>
                <td colSpan={2} style={{ paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Profession</label>
                  <input className="input-field" value={form.profession} onChange={e => set('profession', e.target.value)} placeholder="Trade / profession" />
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Manager</label>
                  <input className="input-field" value={form.callback} onChange={e => set('callback', e.target.value)} placeholder="Manager name" />
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Callback</label>
                  <div className="relative flex items-center">
                    {form.salesman.toLowerCase() === 'yes' && (
                      <svg className="absolute left-2.5 w-4 h-4 text-green-400 fill-current pointer-events-none z-10" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    )}
                    <select className="select-field" style={{ paddingLeft: '2rem' }} value={form.salesman} onChange={e => set('salesman', e.target.value)}>
                      <option value="">—</option>
                      {CALLBACK_OPTIONS.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <PickerSelect label="Rating" value={form.rate} options={RATE_OPTIONS} onChange={v => set('rate', v)} />
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Payment Terms</label>
                  <select className="select-field" value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)}>
                    <option value="">—</option>
                    <option value="Due on Receipt">Due on Receipt</option>
                    <option value="Net 15">Net 15</option>
                    <option value="Net 30">Net 30</option>
                    <option value="Net 60">Net 60</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Tax ID</label>
                  <input className="input-field" value={form.taxId} onChange={e => set('taxId', e.target.value)} placeholder="EIN / Tax ID" />
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Account Number</label>
                  <input className="input-field" value={form.accountNumber} onChange={e => set('accountNumber', e.target.value)} placeholder="Account #" />
                </td>
              </tr>
            </tbody></table>
          </FormSection>
        ) : !isEmployee && (
          <FormSection title="Job">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  {isLeadOrCustomer
                    ? <SalesmanAssigneeInput
                        label={labels.salesman}
                        value={form.salesman}
                        assignedToUid={form.assignedToUid}
                        onChange={(uid, name) => { set('assignedToUid', uid); set('salesman', name) }}
                      />
                    : <PickerInput label={labels.job} value={form.job} options={lists.job} onChange={v => set('job', v)} />}
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  {isLeadOrCustomer
                    ? <PickerInput label={labels.job} value={form.job} options={lists.job} onChange={v => set('job', v)} />
                    : <PickerInput label={labels.product} value={form.product} options={lists.product} onChange={v => set('product', v)} />}
                </td>
              </tr>
              {isLeadOrCustomer && (
                <tr>
                  <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                    <PickerInput label={labels.product} value={form.product} options={lists.product} onChange={v => set('product', v)} />
                  </td>
                  <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                    {isLead ? (
                      <div>
                        <label className="form-label">Quantity</label>
                        <input className="input-field" type="number" min="0" value={form.quantity || ''} onChange={e => set('quantity', parseInt(e.target.value) || 0)} placeholder="0" />
                      </div>
                    ) : (
                      <PickerInput label={labels.contractor} value={form.contractor} options={lists.contractor} onChange={v => set('contractor', v)} />
                    )}
                  </td>
                </tr>
              )}
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Amount ($)</label>
                  <input className="input-field" type="number" min="0" value={form.amount || ''} onChange={e => set('amount', parseFloat(e.target.value) || 0)} placeholder="0" />
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  {!isLead && (
                    <div>
                      <label className="form-label">Quantity</label>
                      <input className="input-field" type="number" min="0" value={form.quantity || ''} onChange={e => set('quantity', parseInt(e.target.value) || 0)} placeholder="0" />
                    </div>
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <PickerSelect label="Rating" value={form.rate} options={RATE_OPTIONS} onChange={v => set('rate', v)} />
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Called</label>
                  <div className="relative flex items-center">
                    {form.callback.toLowerCase() === 'yes' && (
                      <svg className="absolute left-2.5 w-4 h-4 text-green-400 fill-current pointer-events-none z-10" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    )}
                    <select className="select-field" style={{ paddingLeft: '2rem' }} value={form.callback} onChange={e => set('callback', e.target.value)}>
                      <option value="">—</option>
                      {CALLBACK_OPTIONS.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </td>
              </tr>
            </tbody></table>
          </FormSection>
        )}

        {/* Customer Info */}
        {isCustomer && (
          <FormSection title="Customer Info">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Payment Terms</label>
                  <select className="select-field" value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)}>
                    <option value="">—</option>
                    <option value="Due on Receipt">Due on Receipt</option>
                    <option value="Net 15">Net 15</option>
                    <option value="Net 30">Net 30</option>
                    <option value="Net 60">Net 60</option>
                  </select>
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Payment Status</label>
                  <select className="select-field" value={form.paymentStatus} onChange={e => set('paymentStatus', e.target.value)}>
                    <option value="">—</option>
                    <option value="Current">Current</option>
                    <option value="Pending">Pending</option>
                    <option value="Overdue">Overdue</option>
                    <option value="Paid">Paid</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ paddingBottom: '12px', verticalAlign: 'top' }}>
                  <PickerInput label="Lead Source" value={form.leadSource} options={lists.advertiser} onChange={v => set('leadSource', v)} />
                </td>
              </tr>
            </tbody></table>
          </FormSection>
        )}

        {/* Lead Info */}
        {isLead && (
          <FormSection title="Lead Info">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              <tr>
                <td colSpan={2} style={{ paddingBottom: '12px', verticalAlign: 'top' }}>
                  <PickerInput label="Lead Source" value={form.leadSource} options={lists.advertiser} onChange={v => set('leadSource', v)} />
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Lead Status</label>
                  <select className="select-field" value={form.leadStatus} onChange={e => set('leadStatus', e.target.value)}>
                    <option value="">—</option>
                    <option value="New">New</option>
                    <option value="Contacted">Contacted</option>
                    <option value="Qualified">Qualified</option>
                    <option value="Proposal Sent">Proposal Sent</option>
                    <option value="Negotiating">Negotiating</option>
                    <option value="Won">Won</option>
                    <option value="Lost">Lost</option>
                  </select>
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Contact Attempts</label>
                  <input className="input-field" type="number" min="0" value={form.contactAttempts || ''} onChange={e => set('contactAttempts', parseInt(e.target.value) || 0)} placeholder="0" />
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ verticalAlign: 'top' }}>
                  <label className="form-label">Last Contact Date</label>
                  <div style={{ position: 'relative' }}>
                    <div className="input-field" style={{ cursor: 'pointer', userSelect: 'none' }}>
                      {fmtISODate(form.lastContactDate) || <span className="text-gray-400">Select date</span>}
                    </div>
                    <input type="date" value={form.lastContactDate} onChange={e => set('lastContactDate', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                  </div>
                </td>
              </tr>
            </tbody></table>
          </FormSection>
        )}

        {/* Employee Info */}
        {isEmployee && (
          <FormSection title="Employee Info">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Department</label>
                  <input className="input-field" value={form.adNo} onChange={e => set('adNo', e.target.value)} placeholder="Department" />
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <PickerSelect label="Rating" value={form.rate} options={RATE_OPTIONS} onChange={v => set('rate', v)} />
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Salesperson</label>
                  <select className="select-field" value={form.salesman} onChange={e => set('salesman', e.target.value)}>
                    <option value="">—</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Employee Status</label>
                  <select className="select-field" value={form.employeeStatus} onChange={e => set('employeeStatus', e.target.value)}>
                    <option value="">— Select status —</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="On Leave">On Leave</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Pay Type</label>
                  <select className="select-field" value={form.payType} onChange={e => set('payType', e.target.value)}>
                    <option value="">—</option>
                    <option value="Hourly">Hourly</option>
                    <option value="Salary">Salary</option>
                    <option value="Commission">Commission</option>
                    <option value="Contract">Contract</option>
                  </select>
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  <label className="form-label">Commission Rate</label>
                  <input className="input-field" value={form.commissionRate} onChange={e => set('commissionRate', e.target.value)} placeholder="e.g. 10%" />
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', verticalAlign: 'top' }}>
                  <label className="form-label">User Role</label>
                  <div className="flex items-center gap-2">
                    <select
                      className="select-field flex-1"
                      value={form.userRole}
                      onChange={e => set('userRole', e.target.value)}
                    >
                      <option value="">— Select role —</option>
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="salesman">Salesman</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  {lookupStatus === 'linked' && <p className="text-xs text-green-400 mt-1">Linked to {dEmail}</p>}
                  {lookupStatus === 'not-found' && <p className="text-xs text-yellow-500 mt-1">No Firebase account found for {dEmail}</p>}
                  {lookupStatus === 'no-email' && <p className="text-xs text-gray-500 mt-1">Add an email to link a Firebase account</p>}
                  {lookupStatus === 'loading' && <p className="text-xs text-gray-500 mt-1">Looking up…</p>}
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', verticalAlign: 'top' }}>
                  <label className="form-label">Last Login</label>
                  <div style={{ position: 'relative' }}>
                    <div className="input-field" style={{ cursor: 'pointer', userSelect: 'none' }}>
                      {linkedUser?.lastSeen
                        ? fmtDateTime(linkedUser.lastSeen)
                        : fmtISODate(form.lastLogin) || <span className="text-gray-400">Select date</span>}
                    </div>
                    <input type="date" value={form.lastLogin} onChange={e => set('lastLogin', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                  </div>
                </td>
              </tr>
            </tbody></table>
          </FormSection>
        )}

        {/* Dates */}
        <FormSection title="Dates">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  {isCustomer
                    ? <DateField label="Start" value={form.startDate} onChange={d => set('startDate', d)} />
                    : isVendor
                    ? <DateField label="Last Contact Date" value={form.completionDate} onChange={d => set('completionDate', d)} />
                    : isEmployee
                    ? <DateField label="Start Date" value={form.startDate} onChange={d => set('startDate', d)} />
                    : <DateField label="Created" value={form.creationDate} onChange={d => set('creationDate', d)} />}
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: '12px', verticalAlign: 'top' }}>
                  {isLead && <DateField label="Appt Date" value={form.startDate} onChange={d => set('startDate', d)} />}
                  {isEmployee && <DateField label="Termination Date" value={form.completionDate} onChange={d => set('completionDate', d)} />}
                  {isCustomer && <DateField label="Complete" value={form.completionDate} onChange={d => set('completionDate', d)} />}
                  {isVendor && <DateField label="Next Follow-up Date" value={form.followUpDate} onChange={d => set('followUpDate', d)} />}
                </td>
              </tr>
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', verticalAlign: 'top' }}>
                  {(isCustomer || isVendor || isEmployee) && <DateField label="Created" value={form.creationDate} onChange={d => set('creationDate', d)} />}
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', verticalAlign: 'top' }}>
                  <div>
                    <label className="form-label">Last Updated</label>
                    <div className="input-field opacity-60" style={{ cursor: 'default', userSelect: 'none' }}>
                      {form.lastUpdateDate instanceof Date && !isNaN(form.lastUpdateDate.getTime())
                        ? fmtDate(form.lastUpdateDate)
                        : <span className="text-gray-400">—</span>}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </FormSection>

        {/* Personal section — hidden for Vendor; SSN/DL/Dept for Employee only */}
        {!isVendor && <FormSection title="Personal">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {isEmployee && (
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: !isCustomer ? '12px' : 0, verticalAlign: 'top' }}>
                  <label className="form-label">Social Security</label>
                  <input className="input-field" value={form.spouse} onChange={e => set('spouse', e.target.value)} placeholder="###-##-####" />
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: !isCustomer ? '12px' : 0, verticalAlign: 'top' }}>
                  <label className="form-label">Driver License</label>
                  <input
                    className="input-field uppercase"
                    value={form.driverLicense}
                    onChange={e => set('driverLicense', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="License #"
                  />
                </td>
              </tr>
            )}
            {!isEmployee && (
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', paddingBottom: !isCustomer ? '12px' : 0, verticalAlign: 'top' }}>
                  <label className="form-label">Spouse</label>
                  <input className="input-field" value={form.spouse} onChange={e => set('spouse', e.target.value)} placeholder="Spouse name" />
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', paddingBottom: !isCustomer ? '12px' : 0, verticalAlign: 'top' }} />
              </tr>
            )}
            {!isCustomer && (
              <tr>
                <td style={{ width: '50%', paddingRight: '6px', verticalAlign: 'top' }}>
                  <label className="form-label">Birth Date</label>
                  <div style={{ position: 'relative' }}>
                    <div className="input-field" style={{ cursor: 'pointer', userSelect: 'none' }}>
                      {fmtISODate(toISODate(form.birthDate)) || <span className="text-gray-400">Select date</span>}
                    </div>
                    <input type="date" value={toISODate(form.birthDate)} onChange={e => set('birthDate', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                  </div>
                </td>
                <td style={{ width: '50%', paddingLeft: '6px', verticalAlign: 'top' }} />
              </tr>
            )}
          </tbody></table>
        </FormSection>}

        {/* Custom Fields */}
        {customFieldDefs.length > 0 && (
          <FormSection title="Custom Fields">
            <div className="space-y-3">
              {customFieldDefs.map(def => (
                <div key={def.id}>
                  <label className="form-label">{def.label}</label>
                  {def.type === 'select' ? (
                    <select
                      className="select-field"
                      value={form.customFields[def.key] ?? ''}
                      onChange={e => setCustomFieldValue(def.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {def.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      className="input-field"
                      type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
                      value={form.customFields[def.key] ?? ''}
                      onChange={e => setCustomFieldValue(def.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </FormSection>
        )}

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

// Real user picker for Lead/Customer records. Writes both a uid (assignedToUid,
// used by the onCustomerAssigned Cloud Function to notify the salesman) and a
// display name (salesman, for existing UI/reports). Falls back to showing the
// legacy free-text name as a disabled placeholder if it doesn't match a team member.
function SalesmanAssigneeInput({
  label, value, assignedToUid, onChange,
}: {
  label: string
  value: string
  assignedToUid: string
  onChange: (uid: string, displayName: string) => void
}) {
  const [salesmen, setSalesmen] = useState<TeamMember[] | null>(null)

  useEffect(() => {
    fetchSalesmenForCompany().then(setSalesmen).catch(() => setSalesmen([]))
  }, [])

  const matchedUid = salesmen?.some(m => m.uid === assignedToUid) ? assignedToUid : ''

  return (
    <div>
      <label className="form-label">{label}</label>
      <select
        className="select-field"
        value={matchedUid}
        onChange={e => {
          const uid = e.target.value
          const match = (salesmen ?? []).find(m => m.uid === uid)
          onChange(uid, match ? memberDisplayName(match) : '')
        }}
      >
        <option value="">{!matchedUid && value ? `${value} (unlinked)` : '— Unassigned —'}</option>
        {(salesmen ?? []).map(m => (
          <option key={m.uid} value={m.uid}>{memberDisplayName(m)}</option>
        ))}
      </select>
    </div>
  )
}

function toISODate(s: string): string {
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0]
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`
}

function fmtDateTime(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${fmtDate(d)} ${((h % 12) || 12)}:${m} ${ampm}`
}

function fmtISODate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return isNaN(d.getTime()) ? '' : fmtDate(d)
}

function DateField({ label, value, onChange }: { label: string; value: Date | null; onChange: (d: Date) => void }) {
  const iso = value instanceof Date && !isNaN(value.getTime())
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : ''
  const display = value instanceof Date && !isNaN(value.getTime()) ? fmtDate(value) : ''
  return (
    <div>
      <label className="form-label">{label}</label>
      <div style={{ position: 'relative' }}>
        <div className="input-field" style={{ cursor: 'pointer', userSelect: 'none' }}>
          {display || <span className="text-gray-400">—</span>}
        </div>
        <input
          type="date"
          value={iso}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          onChange={e => {
            const d = new Date(e.target.value + 'T00:00:00')
            if (!isNaN(d.getTime())) onChange(d)
          }}
        />
      </div>
    </div>
  )
}
