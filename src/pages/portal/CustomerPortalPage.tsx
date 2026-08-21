import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getPortalSnapshot, submitServiceRequest,
  type CustomerPortalSnapshot, type PortalServiceRequest,
} from '../../services/customerPortalService'

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
function fmtCur(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
function fmtFreq(f: string) {
  return f.charAt(0).toUpperCase() + f.slice(1)
}

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  draft:   { label: 'Draft',   color: '#64748b', bg: '#1e293b' },
  sent:    { label: 'Due',     color: '#2563eb', bg: '#dbeafe' },
  overdue: { label: 'Overdue', color: '#dc2626', bg: '#fee2e2' },
  paid:    { label: 'Paid',    color: '#16a34a', bg: '#dcfce7' },
}

export default function CustomerPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [portal,  setPortal]  = useState<CustomerPortalSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRequest, setShowRequest] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<PortalServiceRequest>({ name: '', phone: '', email: '', description: '', preferredDate: '' })
  const [formErr, setFormErr] = useState('')

  useEffect(() => {
    document.title = 'Customer Portal'
    if (!token) { setLoading(false); return }
    getPortalSnapshot(token)
      .then(p => {
        setPortal(p)
        if (p) {
          document.title = `${p.customerName} — Portal`
          setForm(f => ({ ...f, name: p.customerName, phone: p.customerPhone, email: p.customerEmail }))
        }
      })
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmitRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!form.description.trim()) { setFormErr('Please describe what you need.'); return }
    if (!portal || !token) return
    setSubmitting(true)
    setFormErr('')
    try {
      await submitServiceRequest(token, portal.companyId, portal.customerId, form)
      setSubmitted(true)
      setShowRequest(false)
    } catch {
      setFormErr('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  if (!portal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif', color: '#64748b', padding: 24 }}>
        <p style={{ fontSize: 48, marginBottom: 12 }}>🔒</p>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Portal not found</p>
        <p style={{ fontSize: 14 }}>This link may be invalid or has expired. Contact us for a new link.</p>
      </div>
    )
  }

  const s = { fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f1f5f9', minHeight: '100vh', padding: '24px 16px 60px', color: '#1e293b' }
  const card: React.CSSProperties = { background: 'white', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: 16 }
  const sectionHead: React.CSSProperties = { padding: '14px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderBottom: '1px solid #f1f5f9' }

  return (
    <div style={s}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ ...card, background: '#1e293b', color: 'white', padding: '28px 28px 24px' }}>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Customer Portal</p>
          <p style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>{portal.customerName}</p>
          {portal.customerPhone && <p style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 0' }}>📞 {portal.customerPhone}</p>}
          {portal.customerEmail && <p style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 0' }}>✉ {portal.customerEmail}</p>}
          {portal.customerAddress && <p style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 0' }}>📍 {portal.customerAddress}</p>}
        </div>

        {/* Service request success */}
        {submitted && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 12, padding: '14px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: '#15803d', fontSize: 14 }}>Request received!</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#166534' }}>We'll be in touch shortly to schedule your service.</p>
            </div>
          </div>
        )}

        {/* Request service button */}
        {!submitted && (
          <button
            onClick={() => setShowRequest(r => !r)}
            style={{ width: '100%', background: '#4f46e5', color: 'white', border: 'none', borderRadius: 12, padding: '14px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            🛠 {showRequest ? 'Cancel' : 'Request Service'}
          </button>
        )}

        {/* Service request form */}
        {showRequest && (
          <form onSubmit={handleSubmitRequest} style={{ ...card, padding: 24 }}>
            <p style={{ fontWeight: 700, fontSize: 16, margin: '0 0 16px' }}>New Service Request</p>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Your Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required style={inputStyle} placeholder="Full name" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Phone</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} placeholder="(555) 555-5555" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Preferred Date</label>
                  <input type="date" value={form.preferredDate} onChange={e => setForm(f => ({ ...f, preferredDate: e.target.value }))} style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>What do you need? *</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Describe the service or issue…" />
              </div>
              {formErr && <p style={{ color: '#dc2626', fontSize: 13, margin: 0 }}>{formErr}</p>}
              <button type="submit" disabled={submitting} style={{ background: '#4f46e5', color: 'white', border: 'none', borderRadius: 8, padding: '12px 24px', fontWeight: 600, fontSize: 14, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                {submitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </form>
        )}

        {/* Open invoices */}
        {portal.invoices.length > 0 && (
          <div style={card}>
            <p style={sectionHead}>Open Invoices</p>
            {portal.invoices.map((inv, i) => {
              const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.sent
              return (
                <div key={i} style={{ ...row, borderBottom: i < portal.invoices.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{inv.invoiceNumber}</p>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Due {fmtDate(inv.dueDate)}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{fmtCur(inv.total)}</p>
                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: st.bg, color: st.color }}>{st.label}</span>
                    {inv.shareToken && (
                      <a href={`/i/${inv.shareToken}`} style={{ fontSize: 12, color: '#4f46e5', fontWeight: 600, textDecoration: 'none' }}>Pay →</a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Payment history */}
        {portal.paidHistory.length > 0 && (
          <div style={card}>
            <p style={sectionHead}>Payment History</p>
            {portal.paidHistory.map((inv, i) => (
              <div key={i} style={{ ...row, borderBottom: i < portal.paidHistory.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{inv.invoiceNumber}</p>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Paid {fmtDate(inv.dueDate)}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{fmtCur(inv.total)}</p>
                  <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: STATUS_STYLE.paid.bg, color: STATUS_STYLE.paid.color }}>Paid</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Signed documents */}
        {portal.signedDocuments.length > 0 && (
          <div style={card}>
            <p style={sectionHead}>Signed Documents</p>
            {portal.signedDocuments.map((doc, i) => (
              <div key={i} style={{ ...row, borderBottom: i < portal.signedDocuments.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{doc.templateName}</p>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Signed {fmtDate(doc.signedAt)}</p>
                </div>
                <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#dcfce7', color: '#16a34a' }}>✓ Signed</span>
              </div>
            ))}
          </div>
        )}

        {/* Service plans */}
        {portal.servicePlans.length > 0 && (
          <div style={card}>
            <p style={sectionHead}>Active Service Plans</p>
            {portal.servicePlans.map((p, i) => (
              <div key={i} style={{ ...row, borderBottom: i < portal.servicePlans.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{p.title}</p>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{fmtFreq(p.frequency)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Next service</p>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 0', color: '#0f172a' }}>{fmtDate(p.nextDate)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 24 }}>
          Portal updated {fmtDate(portal.updatedAt)} · Powered by TheLight CRM
        </p>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 14,
  color: '#1e293b',
  background: 'white',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'system-ui, sans-serif',
}
