import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getLeadFormSettings, submitLead } from '../../services/leadFormService'
import { DEFAULT_FORM_SETTINGS, type LeadFormSettings } from '../../models/leadForm'
import { PUBLIC_COLORS as C, PUBLIC_INPUT } from '../../models/publicTheme'
import { PublicGlyph, ICONS } from '../../components/PublicGlyph'

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
  const [submitError, setSubmitError] = useState('')

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
    setSubmitError('')
    setFormState('submitting')
    try {
      await submitLead(companyId, { first, lastname, email, phone, street, city, state, zip, message })
      setFormState('success')
    } catch {
      // A failed submission has to say so. The catch set the state back to
      // 'ready' and nothing else — no message, no indication anything had
      // happened. On a lead-capture form that's the worst available failure:
      // the person believes they've made contact, the company never receives
      // it, and neither side finds out. All that changed on screen was the
      // button stopping saying "Submitting…".
      setSubmitError('We could not send your details just now. Please check your connection and try again.')
      setFormState('ready')
    }
  }

  const s = settings ?? { ...DEFAULT_FORM_SETTINGS, companyId: '', updatedAt: new Date() }

  return (
    <div style={{ minHeight: '100vh', background: C.cardHead, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <style>{`.lead-form input::placeholder, .lead-form textarea::placeholder { color: #71717a; opacity: 1; }`}</style>
      <div className="lead-form" style={{ width: '100%', maxWidth: 520 }}>

        {formState === 'loading' && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <div role="status" aria-label="Loading form" style={{ width: 32, height: 32, border: `3px solid ${C.hairline}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {(formState === 'error') && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <PublicGlyph d={ICONS.documentText} size={40} color={C.inkMuted} style={{ margin: '0 auto 12px' }} />
            <h1 style={{ fontSize: 18, fontWeight: 700, color: C.ink, margin: '0 0 8px' }}>Form not found</h1>
            <p style={{ fontSize: 14, color: C.inkMuted, margin: 0 }}>This link may be invalid or expired.</p>
          </div>
        )}

        {formState === 'disabled' && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <PublicGlyph d={ICONS.lockClosed} size={40} color={C.inkMuted} style={{ margin: '0 auto 12px' }} />
            <h1 style={{ fontSize: 18, fontWeight: 700, color: C.ink, margin: '0 0 8px' }}>Not accepting submissions</h1>
            <p style={{ fontSize: 14, color: C.inkMuted, margin: 0 }}>This form is temporarily closed.</p>
          </div>
        )}

        {formState === 'success' && (
          <div style={{ textAlign: 'center', padding: 48, background: 'white', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: C.positiveSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <PublicGlyph d={ICONS.check} size={28} color="#166534" />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.ink, margin: '0 0 8px' }}>{s.thankYouMessage}</h1>
            <p style={{ fontSize: 14, color: C.inkMuted, margin: 0 }}>We received your information and will follow up soon.</p>
          </div>
        )}

        {(formState === 'ready' || formState === 'submitting') && (
          <form
            onSubmit={handleSubmit}
            style={{ background: 'white', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden' }}
          >
            {/* Header */}
            <div style={{ background: C.band, padding: '28px 32px' }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
              </div>
              {s.businessName && (
                <p style={{ color: '#a5b4fc', fontSize: 13, fontWeight: 600, letterSpacing: '0.02em', margin: '0 0 4px', textTransform: 'uppercase' }}>{s.businessName}</p>
              )}
              <h1 style={{ color: 'white', fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>{s.title}</h1>
              {s.subtitle && <p style={{ color: C.onBand, fontSize: 14, margin: 0 }}>{s.subtitle}</p>}
            </div>

            {/* Body */}
            <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Name row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label htmlFor="lf-first" style={labelStyle}>First Name *</label>
                  <input
                    id="lf-first"
                    required
                    value={first}
                    onChange={e => setFirst(e.target.value)}
                    placeholder="Jane"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label htmlFor="lf-last" style={labelStyle}>Last Name *</label>
                  <input
                    id="lf-last"
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
                <label htmlFor="lf-email" style={labelStyle}>Email *</label>
                <input
                    id="lf-email"
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
                  <label htmlFor="lf-phone" style={labelStyle}>Phone</label>
                  <input
                    id="lf-phone"
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
                    <label htmlFor="lf-street" style={labelStyle}>Street Address</label>
                    <input
                    id="lf-street"
                      value={street}
                      onChange={e => setStreet(e.target.value)}
                      placeholder="123 Main St"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label htmlFor="lf-city" style={labelStyle}>City</label>
                      <input
                    id="lf-city" value={city} onChange={e => setCity(e.target.value)} placeholder="City" style={inputStyle} />
                    </div>
                    <div>
                      <label htmlFor="lf-state" style={labelStyle}>State</label>
                      <input
                    id="lf-state" value={state} onChange={e => setState(e.target.value)} placeholder="FL" style={inputStyle} />
                    </div>
                    <div>
                      <label htmlFor="lf-zip" style={labelStyle}>Zip</label>
                      <input
                    id="lf-zip" value={zip} onChange={e => setZip(e.target.value)} placeholder="33101" style={inputStyle} />
                    </div>
                  </div>
                </>
              )}

              {/* Message */}
              {s.showMessage && (
                <div>
                  <label htmlFor="lf-message" style={labelStyle}>Message</label>
                  <textarea
                    id="lf-message"
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Tell us how we can help…"
                    rows={4}
                    style={{ ...inputStyle, resize: 'none' }}
                  />
                </div>
              )}

              {submitError && (
                <p role="alert" style={{ margin: 0, fontSize: 14, color: C.danger, background: C.dangerSoft, border: `1px solid ${C.dangerLine}`, borderRadius: 8, padding: '10px 12px' }}>
                  {submitError}
                </p>
              )}

              <button
                type="submit"
                disabled={formState === 'submitting'}
                aria-busy={formState === 'submitting'}
                style={{
                  width: '100%',
                  padding: '12px',
                  // A grey fill rather than indigo at 0.7 opacity: compounding
                  // an alpha onto the fill took the white label under AA.
                  background: formState === 'submitting' ? '#6b7280' : C.accent,
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 15,
                  border: 'none',
                  borderRadius: 10,
                  cursor: formState === 'submitting' ? 'not-allowed' : 'pointer',
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
  fontSize: 13,
  fontWeight: 600,
  color: C.inkMuted,
  marginBottom: 6,
}

// The shared field style, which is 16px — anything smaller makes iOS Safari
// zoom the page the moment a field is focused, on a form only ever filled in
// on a phone.
const inputStyle: React.CSSProperties = { ...PUBLIC_INPUT, background: C.cardHead }
