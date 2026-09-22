import { useEffect, useId, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ICONS } from '../../components/Icon'
import {
  getPortalSnapshot, submitServiceRequest, getDayAvailability,
  type CustomerPortalSnapshot, type PortalServiceRequest, type DayAvailability,
} from '../../services/customerPortalService'
import {
  PORTAL_LIMITS, descriptionRemaining, portalSubmitError, validatePortalRequest,
  type FieldError,
} from '../../models/portalRequest'

const AVAILABILITY_WINDOW_DAYS = 14

/**
 * This page is deliberately standalone: inline styles, its own palette, no
 * Tailwind and no app chrome, because it's the only thing a customer sees and
 * it must not inherit the operator-facing dark theme.
 *
 * The cost of that is real, and it showed: none of the app's contrast work
 * reaches here, so every status badge and both muted text roles failed AA —
 * the section headers at 2.45:1, the footer at 2.34:1, and the Draft badge at
 * 3.07:1 because it was the one badge built dark-on-dark while the other three
 * are dark-on-light. The palette is named here so those values have one home
 * and can be checked.
 */
const C = {
  page:        '#f1f5f9',
  card:        '#ffffff',
  cardHead:    '#f8fafc',
  hairline:    '#e2e8f0',
  rowLine:     '#f1f5f9',
  ink:         '#1e293b',
  /** Muted body text. Was #94a3b8 (2.34–2.45:1); this is 6.9–7.2:1. */
  inkMuted:    '#475569',
  /** Secondary text on white only, where it measures 4.76:1. */
  inkSubtle:   '#64748b',
  onDark:      '#94a3b8',
  accent:      '#4f46e5',
  accentSoft:  '#eef2ff',
} as const

/**
 * Status badges, all dark-on-light and all measured.
 *
 * Draft was `color:#64748b` on `bg:#1e293b` — the only one of the four with a
 * *dark* surface, which read as 3.07:1 and looked like a rendering fault beside
 * its three light-surface siblings. Draft invoices do reach this page:
 * generatePortalLink includes everything except paid.
 */
const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  draft:   { label: 'Draft',   color: '#334155', bg: '#f1f5f9' }, // 9.45:1
  sent:    { label: 'Due',     color: '#1e40af', bg: '#dbeafe' }, // 7.15:1
  overdue: { label: 'Overdue', color: '#991b1b', bg: '#fee2e2' }, // 6.80:1
  paid:    { label: 'Paid',    color: '#166534', bg: '#dcfce7' }, // 6.49:1
}

/** An unrecognised status says so rather than silently rendering as "Due". */
const UNKNOWN_STATUS = { label: 'Status unknown', color: '#334155', bg: '#f1f5f9' }

// Local calendar-day string (not toISOString, which is UTC and can shift the
// date near midnight) — matches how every other date picker in this app
// already works off local Date components.
function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtDate(d: Date) {
  if (!d || isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
function fmtCur(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
function fmtFreq(f: string) {
  return f.charAt(0).toUpperCase() + f.slice(1)
}

/**
 * An icon, drawn.
 *
 * The page carried 🔒 📞 ✉ 📍 ✅ 🛠 ✓ as its only iconography — and for the
 * phone, email and address rows the emoji was the field's *only* label, so a
 * screen reader announced "telephone emoji, 555-0100" or nothing at all. Emoji
 * also render from Apple Color Emoji and ignore `color`, which is why the rest
 * of the app replaced its own.
 *
 * Paths come from components/Icon's ICONS so there's one source; this wrapper
 * exists because that component takes Tailwind classes and this page is
 * deliberately inline-styled.
 */
function Glyph({
  d, size = 16, color = 'currentColor', title,
}: {
  d: string | readonly string[]
  size?: number
  color?: string
  title?: string
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: '0 0 auto' }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {(Array.isArray(d) ? d : [d as string]).map((p, i) => <path key={i} d={p} />)}
    </svg>
  )
}

export default function CustomerPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [portal,  setPortal]  = useState<CustomerPortalSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRequest, setShowRequest] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<PortalServiceRequest>({ name: '', phone: '', email: '', description: '', preferredDate: '' })
  const [fieldErr, setFieldErr] = useState<FieldError | null>(null)
  const [submitErr, setSubmitErr] = useState('')
  const [availability, setAvailability] = useState<Record<string, DayAvailability>>({})
  const [availabilityLoading, setAvailabilityLoading] = useState(false)

  // Unique ids so each label is actually associated with its input. None of the
  // four fields had an accessible name: the labels were unassociated <label>
  // elements and the inputs had no id and no aria-label.
  const uid = useId()
  const nameId = `${uid}-name`
  const phoneId = `${uid}-phone`
  const dateId = `${uid}-date`
  const descId = `${uid}-desc`
  const errId = `${uid}-err`

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

  // Fetched once when the request form opens, not on every keystroke — a
  // day that turns out full by the time staff reviews it just gets
  // reassigned on the Dispatch board, same as any other over-capacity day.
  useEffect(() => {
    if (!showRequest || !token) return
    const start = new Date()
    const end = new Date(start.getTime() + AVAILABILITY_WINDOW_DAYS * 86_400_000)
    setAvailabilityLoading(true)
    getDayAvailability(token, toYMD(start), toYMD(end))
      .then(setAvailability)
      .finally(() => setAvailabilityLoading(false))
  }, [showRequest, token])

  async function handleSubmitRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!portal || !token) return

    // Validated against the same bounds firestore.rules enforces. The page used
    // to check only that the description was non-empty, so a long description
    // tripped a rule the customer couldn't see and surfaced as "Something went
    // wrong. Please try again." — advice that could never work.
    const problem = validatePortalRequest(form)
    setFieldErr(problem)
    setSubmitErr('')
    if (problem) return

    setSubmitting(true)
    try {
      await submitServiceRequest(token, portal.companyId, portal.customerId, form)
      setSubmitted(true)
      setShowRequest(false)
      setForm(f => ({ ...f, description: '', preferredDate: '' }))
    } catch (err) {
      setSubmitErr(portalSubmitError(err))
    } finally {
      setSubmitting(false)
    }
  }

  /** Editing any field clears the standing error, so a corrected input doesn't stay flagged. */
  function patch(next: Partial<PortalServiceRequest>) {
    setForm(f => ({ ...f, ...next }))
    if (fieldErr) setFieldErr(null)
    if (submitErr) setSubmitErr('')
  }

  /** Opening the form clears the previous success, so a second request is possible. */
  function toggleRequestForm() {
    setShowRequest(open => {
      if (!open) { setSubmitted(false); setSubmitErr(''); setFieldErr(null) }
      return !open
    })
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.cardHead }}>
        <div
          role="status"
          aria-label="Loading your portal"
          style={{ width: 32, height: 32, border: `3px solid ${C.hairline}`, borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}
        />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  if (!portal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.cardHead, fontFamily: 'system-ui, sans-serif', color: C.inkMuted, padding: 24, textAlign: 'center' }}>
        <Glyph d={ICONS.lockClosed} size={44} color={C.inkSubtle} />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.ink, margin: '14px 0 4px' }}>Portal not found</h1>
        <p style={{ fontSize: 14, margin: 0 }}>This link may be invalid or has expired. Contact us for a new link.</p>
      </div>
    )
  }

  const page = { fontFamily: 'system-ui, -apple-system, sans-serif', background: C.page, minHeight: '100vh', padding: '24px 16px 60px', color: C.ink }
  const card: React.CSSProperties = { background: C.card, borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: 16 }
  const sectionHead: React.CSSProperties = { padding: '14px 24px', background: C.cardHead, borderBottom: `1px solid ${C.hairline}`, fontSize: 11, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 24px' }
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.inkMuted, display: 'block', marginBottom: 4 }
  const contactRow: React.CSSProperties = { fontSize: 13, color: C.onDark, margin: '3px 0 0', display: 'flex', alignItems: 'center', gap: 6 }

  const hasNothing =
    portal.invoices.length === 0 &&
    portal.paidHistory.length === 0 &&
    portal.signedDocuments.length === 0 &&
    portal.servicePlans.length === 0

  const descLeft = descriptionRemaining(form.description)

  return (
    <div style={page}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Header. A real <h1> — the customer's name was a styled <p>, so the
            page had no heading of any level and no document outline. */}
        <div style={{ ...card, background: C.ink, color: 'white', padding: '28px 28px 24px' }}>
          <p style={{ fontSize: 12, color: C.onDark, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Customer Portal</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>{portal.customerName}</h1>
          {portal.customerPhone && (
            <p style={contactRow}>
              <Glyph d={ICONS.phone} size={14} color={C.onDark} title="Phone" />
              <a href={`tel:${portal.customerPhone}`} style={{ color: C.onDark, textDecoration: 'none' }}>{portal.customerPhone}</a>
            </p>
          )}
          {portal.customerEmail && (
            <p style={contactRow}>
              <Glyph d={ICONS.envelope} size={14} color={C.onDark} title="Email" />
              <a href={`mailto:${portal.customerEmail}`} style={{ color: C.onDark, textDecoration: 'none' }}>{portal.customerEmail}</a>
            </p>
          )}
          {portal.customerAddress && (
            <p style={contactRow}>
              <Glyph d={ICONS.mapPin} size={14} color={C.onDark} title="Address" />
              <span>{portal.customerAddress}</span>
            </p>
          )}
        </div>

        {/* Service request success. aria-live so it's announced, since the form
            it replaces has just been removed from the page. */}
        {submitted && (
          <div
            role="status"
            style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 12, padding: '14px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <Glyph d={ICONS.checkCircle} size={20} color="#166534" />
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: '#166534', fontSize: 14 }}>Request received</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#166534' }}>We&rsquo;ll be in touch shortly to schedule your service.</p>
            </div>
          </div>
        )}

        {/* Request service button. Always available — it used to disappear for
            good after one submission, so a customer with a second problem had
            to reload the page to report it. */}
        <button
          onClick={toggleRequestForm}
          aria-expanded={showRequest}
          style={{ width: '100%', background: showRequest ? C.card : C.accent, color: showRequest ? C.ink : 'white', border: showRequest ? `1px solid ${C.hairline}` : 'none', borderRadius: 12, padding: '14px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {!showRequest && <Glyph d={ICONS.wrench} size={17} color="white" />}
          {showRequest ? 'Cancel' : submitted ? 'Request Another Service' : 'Request Service'}
        </button>

        {/* Service request form */}
        {showRequest && (
          <form onSubmit={handleSubmitRequest} style={{ ...card, padding: 24 }} noValidate>
            <h2 style={{ fontWeight: 700, fontSize: 16, margin: '0 0 16px' }}>New Service Request</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label htmlFor={nameId} style={labelStyle}>Your Name</label>
                <input
                  id={nameId}
                  value={form.name}
                  onChange={e => patch({ name: e.target.value })}
                  maxLength={PORTAL_LIMITS.name}
                  style={fieldErr?.field === 'name' ? errorInputStyle : inputStyle}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label htmlFor={phoneId} style={labelStyle}>Phone</label>
                <input
                  id={phoneId}
                  type="tel"
                  value={form.phone}
                  onChange={e => patch({ phone: e.target.value })}
                  maxLength={PORTAL_LIMITS.phone}
                  style={fieldErr?.field === 'phone' ? errorInputStyle : inputStyle}
                  placeholder="(555) 555-5555"
                />
              </div>
              <div>
                <label htmlFor={dateId} style={{ ...labelStyle, marginBottom: 6 }}>Preferred Date</label>
                <DayPicker
                  groupId={dateId}
                  value={form.preferredDate ?? ''}
                  onChange={dateStr => patch({ preferredDate: dateStr })}
                  availability={availability}
                  loading={availabilityLoading}
                />
              </div>
              <div>
                <label htmlFor={descId} style={labelStyle}>
                  What do you need? <span style={{ color: '#b91c1c' }}>*</span>
                </label>
                <textarea
                  id={descId}
                  value={form.description}
                  onChange={e => patch({ description: e.target.value })}
                  rows={3}
                  maxLength={PORTAL_LIMITS.description}
                  aria-describedby={fieldErr ? errId : undefined}
                  aria-invalid={fieldErr?.field === 'description' || undefined}
                  style={{ ...(fieldErr?.field === 'description' ? errorInputStyle : inputStyle), resize: 'vertical' }}
                  placeholder="Describe the service or issue…"
                />
                {/* Only once it matters, so it isn't noise on an empty form. */}
                {descLeft < 300 && (
                  <p style={{ fontSize: 11, color: descLeft < 0 ? '#b91c1c' : C.inkSubtle, margin: '4px 0 0' }}>
                    {descLeft < 0
                      ? `${Math.abs(descLeft).toLocaleString()} characters over the limit`
                      : `${descLeft.toLocaleString()} characters left`}
                  </p>
                )}
              </div>

              {/* role="alert" so a submit that fails validation is announced.
                  The old message was a plain <p> with no live region, so a
                  screen-reader user got no feedback at all. */}
              {(fieldErr || submitErr) && (
                <p id={errId} role="alert" style={{ color: '#b91c1c', fontSize: 13, margin: 0 }}>
                  {fieldErr?.message ?? submitErr}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{ background: C.accent, color: 'white', border: 'none', borderRadius: 8, padding: '12px 24px', fontWeight: 600, fontSize: 14, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </form>
        )}

        {/* Open invoices */}
        {portal.invoices.length > 0 && (
          <section style={card}>
            <h2 style={sectionHead}>Open Invoices</h2>
            {portal.invoices.map((inv, i) => {
              const st = STATUS_STYLE[inv.status] ?? UNKNOWN_STATUS
              return (
                <div key={inv.id || i} style={{ ...row, borderBottom: i < portal.invoices.length - 1 ? `1px solid ${C.rowLine}` : 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{inv.invoiceNumber || 'Invoice'}</p>
                    <p style={{ fontSize: 12, color: C.inkSubtle, margin: 0 }}>Due {fmtDate(inv.dueDate)}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{fmtCur(inv.total)}</p>
                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
                    {inv.shareToken && (
                      <a
                        href={`/i/${inv.shareToken}`}
                        aria-label={`Pay invoice ${inv.invoiceNumber || ''}`.trim()}
                        style={{ fontSize: 12, color: C.accent, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
                      >
                        Pay →
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {/* Payment history */}
        {portal.paidHistory.length > 0 && (
          <section style={card}>
            <h2 style={sectionHead}>Payment History</h2>
            {portal.paidHistory.map((inv, i) => (
              <div key={inv.id || i} style={{ ...row, borderBottom: i < portal.paidHistory.length - 1 ? `1px solid ${C.rowLine}` : 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{inv.invoiceNumber || 'Invoice'}</p>
                  <p style={{ fontSize: 12, color: C.inkSubtle, margin: 0 }}>Paid {fmtDate(inv.dueDate)}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{fmtCur(inv.total)}</p>
                  <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: STATUS_STYLE.paid.bg, color: STATUS_STYLE.paid.color }}>Paid</span>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Signed documents */}
        {portal.signedDocuments.length > 0 && (
          <section style={card}>
            <h2 style={sectionHead}>Signed Documents</h2>
            {portal.signedDocuments.map((doc, i) => (
              <div key={i} style={{ ...row, borderBottom: i < portal.signedDocuments.length - 1 ? `1px solid ${C.rowLine}` : 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{doc.templateName || 'Document'}</p>
                  <p style={{ fontSize: 12, color: C.inkSubtle, margin: 0 }}>Signed {fmtDate(doc.signedAt)}</p>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#dcfce7', color: '#166534', flexShrink: 0 }}>
                  <Glyph d={ICONS.check} size={11} color="#166534" />
                  Signed
                </span>
              </div>
            ))}
          </section>
        )}

        {/* Service plans */}
        {portal.servicePlans.length > 0 && (
          <section style={card}>
            <h2 style={sectionHead}>Active Service Plans</h2>
            {portal.servicePlans.map((p, i) => (
              <div key={i} style={{ ...row, borderBottom: i < portal.servicePlans.length - 1 ? `1px solid ${C.rowLine}` : 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>{p.title || 'Service plan'}</p>
                  <p style={{ fontSize: 12, color: C.inkSubtle, margin: 0 }}>{fmtFreq(p.frequency)}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ fontSize: 12, color: C.inkSubtle, margin: 0 }}>Next service</p>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: '2px 0 0' }}>{fmtDate(p.nextDate)}</p>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Something rather than nothing. With no invoices, plans or documents
            every card above is conditional, so the page rendered a header, a
            button and a footer with no indication that was the whole thing. */}
        {hasNothing && (
          <div style={{ ...card, padding: '28px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>Nothing outstanding</p>
            <p style={{ fontSize: 13, color: C.inkSubtle, margin: 0 }}>
              You have no open invoices, service plans or signed documents right now.
            </p>
          </div>
        )}

        {/* Footer. "as of" rather than "updated", because this is a snapshot
            written when staff generated the link — not live data — so an
            invoice paid since then can still show as due. */}
        <p style={{ textAlign: 'center', fontSize: 12, color: C.inkMuted, marginTop: 24 }}>
          Showing information as of {fmtDate(portal.updatedAt)} · Powered by TheLight CRM
        </p>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: `1px solid ${C.hairline}`,
  borderRadius: 8,
  fontSize: 16, // 16px stops iOS Safari zooming the page on focus
  color: C.ink,
  background: C.card,
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'system-ui, sans-serif',
}

const errorInputStyle: React.CSSProperties = { ...inputStyle, border: '1px solid #b91c1c' }

// Day-strip picker for the service-request form's "Preferred Date" — shows
// the next AVAILABILITY_WINDOW_DAYS days, dimming/disabling any the server
// reports as full. Deliberately day-only, no times and no tech names — the
// customer never sees the real schedule, only open/full per day.
function DayPicker({
  groupId, value, onChange, availability, loading,
}: {
  groupId: string
  value: string
  onChange: (dateStr: string) => void
  availability: Record<string, DayAvailability>
  loading: boolean
}) {
  // Built once per mount. `new Date()` inside the render body meant the strip
  // could straddle midnight and re-derive a different set of days mid-session.
  const daysRef = useRef<Date[] | null>(null)
  if (!daysRef.current) {
    daysRef.current = Array.from({ length: AVAILABILITY_WINDOW_DAYS }, (_, i) => {
      const d = new Date()
      d.setHours(12, 0, 0, 0)
      d.setDate(d.getDate() + i)
      return d
    })
  }
  const days = daysRef.current

  return (
    <div>
      {/* A radiogroup, so the strip announces itself as one control with a
          selected option. The buttons previously carried no pressed state at
          all — selection was conveyed only by a border colour. */}
      <div role="radiogroup" aria-labelledby={groupId} style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
        {days.map(d => {
          const dateStr = toYMD(d)
          const full = !loading && availability[dateStr]?.full === true
          const selected = value === dateStr
          const longLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
          return (
            <button
              key={dateStr}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={full}
              // Without this the button's name is "Mon 5" and its unavailable
              // state is a 9px red word.
              aria-label={full ? `${longLabel} — fully booked` : longLabel}
              onClick={() => onChange(dateStr)}
              style={{
                flex: '0 0 auto',
                minWidth: 52,
                minHeight: 56,
                padding: '8px 6px',
                borderRadius: 8,
                border: selected ? `2px solid ${C.accent}` : `1px solid ${C.hairline}`,
                background: full ? C.page : selected ? C.accentSoft : C.card,
                color: full ? C.inkMuted : C.ink,
                cursor: full ? 'not-allowed' : 'pointer',
                textAlign: 'center',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, color: full ? C.inkMuted : C.inkSubtle }}>
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              {/* Was #94a3b8 on the full-day surface: 2.34:1. */}
              <div style={{ fontSize: 14, fontWeight: 700 }}>{d.getDate()}</div>
              {full && <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }}>Full</div>}
            </button>
          )
        })}
      </div>
      {value && (
        <p style={{ fontSize: 12, color: C.inkSubtle, margin: '6px 0 0' }}>
          Selected: {new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      )}
    </div>
  )
}
