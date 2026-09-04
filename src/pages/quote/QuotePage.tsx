import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getCustomer } from '../../services/customerService'
import { fullName, formatCurrency, type CustomerItem } from '../../models/customer'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  subscribeToCompanyProfile, saveCompanyProfile, EMPTY_PROFILE, type CompanyProfile,
} from '../../services/companyProfileService'

type CompanyInfo = CompanyProfile

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime()) || d.getTime() < 86_400_000) return ''
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function quoteNumber(id: string): string {
  return `QT-${id.slice(-6).toUpperCase()}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WorkRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <tr>
      <td style={{ paddingBottom: 10, paddingRight: 16, fontSize: 13, color: '#94a3b8', verticalAlign: 'top', width: 140, whiteSpace: 'nowrap' }}>
        {label}
      </td>
      <td style={{ paddingBottom: 10, fontSize: 14, color: '#1e293b', fontWeight: 500 }}>
        {value}
      </td>
    </tr>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function QuotePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<CustomerItem | null>(null)
  const [loading, setLoading]   = useState(true)
  const [co, setCo]             = useState<CompanyInfo>(EMPTY_PROFILE)
  const [notes, setNotes]       = useState(() => localStorage.getItem(`thelight.quote.notes.${id}`) ?? '')
  const coSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  usePageTitle(customer ? `Quote — ${fullName(customer)}` : 'Quote')

  useEffect(() => subscribeToCompanyProfile(setCo, () => {}), [])

  useEffect(() => {
    if (!id) return
    getCustomer(id)
      .then(c => { setCustomer(c); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  // Inject @media print CSS: hide sidebar/nav, strip background
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'quote-print'
    style.textContent = `
      @media print {
        body { background: white !important; }
        .no-print { display: none !important; }
        aside, nav, header { display: none !important; }
        .quote-doc { box-shadow: none !important; border-radius: 0 !important; }
        textarea { border: none !important; background: transparent !important; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('quote-print')?.remove() }
  }, [])

  function updateCo(field: keyof CompanyInfo, value: string) {
    const next = { ...co, [field]: value }
    setCo(next)
    // Debounce the Firestore write so typing doesn't fire a save per keystroke.
    if (coSaveTimer.current) clearTimeout(coSaveTimer.current)
    coSaveTimer.current = setTimeout(() => { saveCompanyProfile(next).catch(() => {}) }, 600)
  }

  function saveNotes(v: string) {
    setNotes(v)
    localStorage.setItem(`thelight.quote.notes.${id}`, v)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="p-12 text-center text-gray-400">
        Record not found.{' '}
        <Link to="/records" className="text-indigo-400 hover:text-indigo-300">Go back</Link>
      </div>
    )
  }

  const today     = new Date()
  const validDate = new Date(today); validDate.setDate(today.getDate() + 30)
  const name      = fullName(customer)
  const address   = [customer.street, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')

  return (
    <div className="min-h-full bg-gray-950 py-6 px-4">

      {/* ── Toolbar (hidden on print) ── */}
      <div className="no-print max-w-3xl mx-auto mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <Link to={`/records/${id}`} className="text-indigo-400 hover:text-indigo-300 text-sm">
            ← Back to record
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/invoices/new?fromQuote=${id}`)}
              className="btn-secondary text-sm px-4 py-2 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              Convert to Invoice
            </button>
            <button
              onClick={() => window.print()}
              className="btn-primary text-sm px-4 py-2 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
              </svg>
              Print / Save PDF
            </button>
          </div>
        </div>

        {/* Company info editor */}
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-3">Your Company Info</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { field: 'name',    label: 'Company Name', placeholder: 'Your Company' },
              { field: 'phone',   label: 'Phone',        placeholder: '(555) 000-0000' },
              { field: 'address', label: 'Address',      placeholder: '123 Main St, City, ST' },
              { field: 'email',   label: 'Email',        placeholder: 'info@company.com' },
            ] as const).map(({ field, label, placeholder }) => (
              <div key={field}>
                <label className="text-xs text-gray-500 block mb-1">{label}</label>
                <input
                  value={co[field]}
                  onChange={e => updateCo(field, e.target.value)}
                  className="input-field text-sm py-1.5"
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-2">Saved automatically — reused on every quote.</p>
        </div>
      </div>

      {/* ── Quote document ── */}
      <div className="quote-doc paper max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* Header band */}
        <div style={{ background: '#1e293b', padding: '32px 40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <span style={{ color: 'white', fontSize: 20, fontWeight: 700 }}>
                  {(co.name || 'C')[0].toUpperCase()}
                </span>
              </div>
              <p style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: 0 }}>
                {co.name || 'Your Company'}
              </p>
              {co.address && <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0' }}>{co.address}</p>}
              <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
                {co.phone && <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>{co.phone}</p>}
                {co.email && <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>{co.email}</p>}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <p style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
                Estimate
              </p>
              <p style={{ color: 'white', fontSize: 22, fontWeight: 700, margin: '4px 0 0' }}>
                {quoteNumber(customer.id)}
              </p>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: '10px 0 0' }}>Date: {fmtDate(today)}</p>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0' }}>Valid until: {fmtDate(validDate)}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '36px 40px', background: 'white' }}>

          {/* Prepared For */}
          <div style={{ marginBottom: 30 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
              Prepared For
            </p>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>{name || '—'}</p>
            {address && <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>{address}</p>}
            {customer.phone && <p style={{ fontSize: 14, color: '#475569', margin: '3px 0 0' }}>{customer.phone}</p>}
            {customer.email && <p style={{ fontSize: 14, color: '#475569', margin: '3px 0 0' }}>{customer.email}</p>}
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', margin: '0 0 30px' }} />

          {/* Scope of Work */}
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px' }}>
              Scope of Work
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <WorkRow label="Job Type"       value={customer.job} />
                <WorkRow label="Product"        value={customer.product} />
                <WorkRow label="Contractor"     value={customer.contractor} />
                <WorkRow label="Representative" value={customer.salesman} />
                {customer.quantity > 0 && <WorkRow label="Quantity" value={String(customer.quantity)} />}
                <WorkRow label="Reference #"    value={customer.adNo} />
              </tbody>
            </table>

            {/* Date range pill */}
            {(fmtDate(customer.startDate) || fmtDate(customer.completionDate)) && (
              <div style={{ display: 'flex', gap: 32, background: '#f8fafc', borderRadius: 10, padding: '14px 18px', marginTop: 14, flexWrap: 'wrap' }}>
                {fmtDate(customer.startDate) && (
                  <div>
                    <p style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Start</p>
                    <p style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, margin: '4px 0 0' }}>{fmtDate(customer.startDate)}</p>
                  </div>
                )}
                {fmtDate(customer.completionDate) && (
                  <div>
                    <p style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Est. Completion</p>
                    <p style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, margin: '4px 0 0' }}>{fmtDate(customer.completionDate)}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Total */}
          {customer.amount > 0 && (
            <>
              <div style={{ borderTop: '1px solid #e2e8f0', margin: '0 0 18px' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 28 }}>
                <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px 24px', textAlign: 'right', minWidth: 200 }}>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Total Estimate</p>
                  <p style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', margin: '4px 0 0' }}>
                    {formatCurrency(customer.amount)}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Notes / Terms */}
          <div style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
              Notes &amp; Terms
            </p>
            <textarea
              value={notes}
              onChange={e => saveNotes(e.target.value)}
              rows={4}
              placeholder="Payment due upon completion. Price includes all materials and labor. Any additional scope will be quoted separately…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: 10, padding: '12px 14px',
                fontSize: 13, color: '#334155',
                resize: 'vertical', outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.7,
              }}
            />
          </div>

          {/* Signature lines */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 32 }}>
            <div style={{ display: 'flex', gap: 48 }}>
              <div style={{ flex: 1 }}>
                <div style={{ borderBottom: '1px solid #cbd5e1', height: 36, marginBottom: 6 }} />
                <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Customer Signature</p>
              </div>
              <div style={{ width: 160 }}>
                <div style={{ borderBottom: '1px solid #cbd5e1', height: 36, marginBottom: 6 }} />
                <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Date</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 48, marginTop: 24 }}>
              <div style={{ flex: 1 }}>
                <div style={{ borderBottom: '1px solid #cbd5e1', height: 36, marginBottom: 6 }} />
                <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Authorized Signature</p>
              </div>
              <div style={{ width: 160 }}>
                <div style={{ borderBottom: '1px solid #cbd5e1', height: 36, marginBottom: 6 }} />
                <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Date</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
              Thank you for your business.
              {(co.phone || co.email) ? ` Questions? ${co.phone || co.email}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="no-print" style={{ height: 48 }} />
    </div>
  )
}
