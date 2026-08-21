import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getLeadFormSettings, submitLead } from '../../services/leadFormService'
import { DEFAULT_FORM_SETTINGS, type LeadFormSettings } from '../../models/leadForm'

type FormState = 'loading' | 'ready' | 'submitting' | 'success' | 'disabled' | 'error'

export default function PublicLeadFormPage() {
  const { companyId } = useParams<{ companyId: string }>()

  const [formState, setFormState] = useState<FormState>('loading')
  const [settings,  setSettings]  = useState<LeadFormSettings | null>(null)

  const [first,    setFirst]    = useState('')
  const [lastname, setLastname] = useState('')
  const [email,    setEmail]    = useState('')
  const [phone,    setPhone]    = useState('')
  const [street,   setStreet]   = useState('')
  const [city,     setCity]     = useState('')
  const [state,    setState]    = useState('')
  const [zip,      setZip]      = useState('')
  const [message,  setMessage]  = useState('')

  useEffect(() => {
    if (!companyId) { setFormState('error'); return }
    getLeadFormSettings(companyId)
      .then(s => {
        setSettings(s)
        if (!s) setFormState('error')
        else if (!s.enabled) setFormState('disabled')
        else setFormState('ready')
      })
      .catch(() => setFormState('error'))
  }, [companyId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId || !settings) return
    setFormState('submitting')
    try {
      await submitLead(companyId, { first, lastname, email, phone, street, city, state, zip, message })
      setFormState('success')
    } catch {
      setFormState('ready')
    }
  }

  const s = settings ?? { ...DEFAULT_FORM_SETTINGS, companyId: '', updatedAt: new Date() }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>

        {formState === 'loading' && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {(formState === 'error') && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>🔍</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>Form not found</p>
            <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>This link may be invalid or expired.</p>
          </div>
        )}

        {formState === 'disabled' && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>🚫</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>Not accepting submissions</p>
            <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>This form is temporarily closed.</p>
          </div>
        )}

        {formState === 'success' && (
          <div style={{ textAlign: 'center', padding: 48, background: 'white', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 28 }}>✓</div>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>{s.thankYouMessage}</p>
            <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>We received your information and will follow up soon.</p>
          </div>
        )}

        {(formState === 'ready' || formState === 'submitting') && (
          <form
            onSubmit={handleSubmit}
            style={{ background: 'white', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden' }}
          >
            {/* Header */}
            <div style={{ background: '#1e293b', padding: '28px 32px' }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
              </div>
              <p style={{ color: 'white', fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>{s.title}</p>
              {s.subtitle && <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>{s.subtitle}</p>}
            </div>

            {/* Body */}
            <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Name row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>First Name *</label>
                  <input
                    required
                    value={first}
                    onChange={e => setFirst(e.target.value)}
                    placeholder="Jane"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Last Name *</label>
                  <input
                    required
                    value={lastname}
                    onChange={e => setLastname(e.target.value)}
                    placeholder="Smith"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label style={labelStyle}>Email *</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  style={inputStyle}
                />
              </div>

              {/* Phone */}
              {s.showPhone && (
                <div>
                  <label style={labelStyle}>Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="(555) 000-0000"
                    style={inputStyle}
                  />
                </div>
              )}

              {/* Address */}
              {s.showAddress && (
                <>
                  <div>
                    <label style={labelStyle}>Street Address</label>
                    <input
                      value={street}
                      onChange={e => setStreet(e.target.value)}
                      placeholder="123 Main St"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>City</label>
                      <input value={city} onChange={e => setCity(e.target.value)} placeholder="City" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>State</label>
                      <input value={state} onChange={e => setState(e.target.value)} placeholder="FL" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Zip</label>
                      <input value={zip} onChange={e => setZip(e.target.value)} placeholder="33101" style={inputStyle} />
                    </div>
                  </div>
                </>
              )}

              {/* Message */}
              {s.showMessage && (
                <div>
                  <label style={labelStyle}>Message</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Tell us how we can help…"
                    rows={4}
                    style={{ ...inputStyle, resize: 'none' }}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={formState === 'submitting'}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: formState === 'submitting' ? '#6366f1' : '#4f46e5',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 15,
                  border: 'none',
                  borderRadius: 10,
                  cursor: formState === 'submitting' ? 'not-allowed' : 'pointer',
                  opacity: formState === 'submitting' ? 0.7 : 1,
                  transition: 'background 0.15s',
                  marginTop: 4,
                }}
              >
                {formState === 'submitting' ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: '#64748b',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#f8fafc',
  border: '1.5px solid #e2e8f0',
  borderRadius: 8,
  fontSize: 14,
  color: '#0f172a',
  outline: 'none',
  boxSizing: 'border-box',
}
