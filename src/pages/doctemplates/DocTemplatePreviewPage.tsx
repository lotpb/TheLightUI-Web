import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getDocTemplate } from '../../services/docTemplateService'
import { subscribeToCustomers } from '../../services/customerService'
import { fullName, type CustomerItem } from '../../models/customer'
import {
  KIND_LABELS, buildDocVars, interpolateDoc,
  type DocTemplate,
} from '../../models/docTemplate'
import { createSigningRequest } from '../../services/signingRequestService'
import type { SigningDocSnapshot } from '../../models/signingRequest'
import { useAuthStore } from '../../stores/authStore'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { subscribeToCompanyProfile, EMPTY_PROFILE, type CompanyProfile } from '../../services/companyProfileService'

export default function DocTemplatePreviewPage() {
  const { id } = useParams<{ id: string }>()
  const companyId = useAuthStore(s => s.companyId)

  const [template,   setTemplate]   = useState<DocTemplate | null>(null)
  const [customers,  setCustomers]  = useState<CustomerItem[]>([])
  const [selected,   setSelected]   = useState<CustomerItem | null>(null)
  const [query,      setQuery]      = useState('')
  const [showList,   setShowList]   = useState(false)
  const [tplLoading, setTplLoading] = useState(true)
  const [co,         setCo]         = useState<CompanyProfile>(EMPTY_PROFILE)
  const [signLink,   setSignLink]   = useState<string | null>(null)
  const [signSending, setSignSending] = useState(false)
  const toast = useToast()

  useEffect(() => subscribeToCompanyProfile(setCo, () => {}), [])

  usePageTitle(template ? `Generate — ${template.name}` : 'Generate Document')

  useEffect(() => {
    if (!id) return
    getDocTemplate(id)
      .then(t => { setTemplate(t); setTplLoading(false) })
      .catch(() => setTplLoading(false))
  }, [id])

  useEffect(() => {
    const unsub = subscribeToCustomers(items => setCustomers(items), () => {})
    return unsub
  }, [companyId])

  // Inject print CSS
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'doc-print'
    style.textContent = `
      @media print {
        body { background: white !important; }
        .no-print { display: none !important; }
        aside, nav, header { display: none !important; }
        .doc-card { box-shadow: none !important; border-radius: 0 !important; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('doc-print')?.remove() }
  }, [])

  const suggestions = useMemo(() => {
    if (!showList) return []
    const q = query.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers.filter(c =>
      fullName(c).toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q),
    ).slice(0, 8)
  }, [customers, query, showList])

  function selectCustomer(c: CustomerItem) {
    setSelected(c)
    setQuery(fullName(c))
    setShowList(false)
  }

  const vars  = useMemo(() => selected ? buildDocVars(selected) : {}, [selected])
  const fill  = (text: string) => selected ? interpolateDoc(text, vars) : text

  async function handleSendForSignature() {
    if (!template || !selected) return
    setSignSending(true)
    setSignLink(null)
    try {
      const docSnap: SigningDocSnapshot = {
        templateName:   template.name,
        templateKind:   template.kind,
        intro:          fill(template.intro),
        sections:       template.sections.map(s => ({ heading: fill(s.heading), body: fill(s.body) })),
        closing:        fill(template.closing),
        companyName:    co.name,
        companyAddress: co.address,
        companyPhone:   co.phone,
        companyEmail:   co.email,
        customerName:   fullName(selected),
        customerEmail:  selected.email,
        customerPhone:  selected.phone,
        customerStreet: selected.street,
        customerCity:   selected.city,
        customerState:  selected.state,
        customerZip:    selected.zip,
      }
      const token = await createSigningRequest(template.id, selected.id, docSnap)
      const link  = `${window.location.origin}/sign/${token}`
      setSignLink(link)
      await navigator.clipboard.writeText(link).catch(() => {})
      toast('Signing link created and copied to clipboard', 'success')
    } catch {
      toast('Failed to create signing request', 'error')
    } finally {
      setSignSending(false)
    }
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  if (tplLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!template) {
    return (
      <div className="p-12 text-center text-gray-400">
        Template not found.{' '}
        <Link to="/doc-templates" className="text-indigo-400 hover:text-indigo-300">Back to templates</Link>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gray-950 py-6 px-4">

      {/* ── Toolbar ── */}
      <div className="no-print max-w-3xl mx-auto mb-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Link to="/doc-templates" className="text-indigo-400 hover:text-indigo-300 text-sm">
            ← Back to templates
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-400">{template.name}</span>
            <button
              onClick={handleSendForSignature}
              disabled={!selected || signSending}
              className="btn-secondary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
              {signSending ? 'Creating…' : 'Send for E-Signature'}
            </button>
            <button
              onClick={() => window.print()}
              disabled={!selected}
              className="btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
              </svg>
              Print / Save PDF
            </button>
          </div>
        </div>

        {/* Signing link banner */}
        {signLink && (
          <div className="card p-4 border border-green-700/40 bg-green-900/20">
            <p className="text-xs font-semibold text-green-400 mb-2">✓ Signing link ready — share with {selected ? fullName(selected) : 'customer'}</p>
            <div className="flex items-center gap-2">
              <input readOnly value={signLink} className="input-field flex-1 text-xs py-1.5 font-mono" />
              <button
                onClick={async () => { await navigator.clipboard.writeText(signLink); toast('Copied!', 'success') }}
                className="btn-secondary text-xs px-3 py-1.5 shrink-0"
              >
                Copy
              </button>
              <Link to="/signing-requests" className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 px-2">
                View all →
              </Link>
            </div>
          </div>
        )}

        {/* Company info */}
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
                  onChange={e => {
                    const next = { ...co, [field]: e.target.value }
                    setCo(next)
                    localStorage.setItem(`thelight.co.${field}`, e.target.value)
                  }}
                  className="input-field text-sm py-1.5"
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-2">Saved automatically — shared with quotes.</p>
        </div>

        {/* Customer picker */}
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-3">Prepare For</p>
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setShowList(true) }}
              onFocus={() => setShowList(true)}
              onBlur={() => setTimeout(() => setShowList(false), 200)}
              placeholder="Search customers…"
              className="input-field w-full text-sm py-2"
            />
            {showList && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-20 overflow-hidden">
                {suggestions.map(c => (
                  <button
                    key={c.id}
                    onPointerDown={() => selectCustomer(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-700/50 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-200">{fullName(c)}</p>
                    <p className="text-xs text-gray-500">{c.phone || c.email || c.city}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!selected && (
            <p className="text-xs text-gray-600 mt-2">Select a customer to fill merge fields and enable printing.</p>
          )}
        </div>
      </div>

      {/* ── Document ── */}
      <div className="doc-card max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">

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
                {KIND_LABELS[template.kind]}
              </p>
              <p style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{template.name}</p>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: '10px 0 0' }}>Date: {today}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '36px 40px', background: 'white' }}>

          {/* Prepared For */}
          {selected && (
            <>
              <div style={{ marginBottom: 28 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
                  Prepared For
                </p>
                <p style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>{fullName(selected)}</p>
                {selected.street && <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>{selected.street}</p>}
                {(selected.city || selected.state) && (
                  <p style={{ fontSize: 14, color: '#475569', margin: '2px 0 0' }}>
                    {[selected.city, selected.state, selected.zip].filter(Boolean).join(', ')}
                  </p>
                )}
                {selected.phone && <p style={{ fontSize: 14, color: '#475569', margin: '3px 0 0' }}>{selected.phone}</p>}
                {selected.email && <p style={{ fontSize: 14, color: '#475569', margin: '3px 0 0' }}>{selected.email}</p>}
              </div>
              <div style={{ borderTop: '1px solid #e2e8f0', margin: '0 0 28px' }} />
            </>
          )}

          {/* Intro */}
          {template.intro && (
            <div style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                {fill(template.intro)}
              </p>
            </div>
          )}

          {/* Sections */}
          {template.sections.map((sec, idx) => (
            <div key={idx} style={{ marginBottom: 28 }}>
              {sec.heading && (
                <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>
                  {fill(sec.heading)}
                </p>
              )}
              {sec.body && (
                <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {fill(sec.body)}
                </p>
              )}
            </div>
          ))}

          {/* Closing */}
          {template.closing && (
            <>
              <div style={{ borderTop: '1px solid #e2e8f0', margin: '0 0 20px' }} />
              <div style={{ marginBottom: 32 }}>
                <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {fill(template.closing)}
                </p>
              </div>
            </>
          )}

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
              {co.name || 'Your Company'}
              {(co.phone || co.email) ? ` · ${co.phone || co.email}` : ''}
            </p>
          </div>

        </div>
      </div>

      <div className="no-print" style={{ height: 48 }} />
    </div>
  )
}
