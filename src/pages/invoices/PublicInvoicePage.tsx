import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getPublicInvoice, type PublicInvoiceSnapshot } from '../../services/publicInvoiceService'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { fmtCurrency, lineItemTotal } from '../../models/invoice'
import { isSafeHttpUrl } from '../../utils/safeUrl'
import {
  PUBLIC_COLORS as C, PUBLIC_FONT, fmtPublicDate, publicBadge,
} from '../../models/publicTheme'
import { PublicGlyph, ICONS } from '../../components/PublicGlyph'

function subtotal(inv: PublicInvoiceSnapshot) {
  return inv.lineItems.reduce((s, l) => s + lineItemTotal(l), 0)
}
function taxAmount(inv: PublicInvoiceSnapshot) {
  return subtotal(inv) * (inv.taxRate / 100)
}
function total(inv: PublicInvoiceSnapshot) {
  return subtotal(inv) + taxAmount(inv)
}

/**
 * Which badge to show, mirroring models/invoice's effectiveStatus.
 *
 * The local version ended in `default:` returning DUE, so any status the app
 * gains later would be presented to a customer as an unpaid invoice. It also
 * hardcoded three colour pairs that measured 3.00, 3.95 and 4.24:1 — every one
 * below AA for an 11px bold label.
 */
function invoiceBadge(status: string, dueDate: Date) {
  if (status === 'paid' || status === 'draft') return publicBadge(status)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  if (dueDate instanceof Date && !isNaN(dueDate.getTime()) && dueDate < today) {
    return publicBadge('overdue')
  }
  return publicBadge(status)
}

export default function PublicInvoicePage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const [invoice, setInvoice] = useState<PublicInvoiceSnapshot | null>(null)
  const [loading, setLoading]  = useState(true)
  const [paying, setPaying]    = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const justPaid = searchParams.get('paid') === '1'

  useEffect(() => {
    document.title = 'Invoice'
    if (!token) { setLoading(false); return }
    getPublicInvoice(token)
      .then(inv => { setInvoice(inv); if (inv) document.title = `Invoice ${inv.invoiceNumber}` })
      .finally(() => setLoading(false))
  }, [token])

  async function handlePayNow() {
    if (!token || !invoice) return
    // If a custom payment link is stored on the snapshot, use it directly —
    // but only if it's a genuine http(s) URL. A non-http(s) value can't be a
    // legitimate payment link, so surface an error instead of navigating
    // there or silently falling back to a processor the company didn't ask for.
    if (invoice.paymentLink) {
      if (!isSafeHttpUrl(invoice.paymentLink)) {
        setPayError('This invoice\'s payment link is misconfigured. Please contact us directly.')
        return
      }
      window.location.href = invoice.paymentLink
      return
    }
    // Fall back to Stripe Checkout Session (requires STRIPE_SECRET_KEY configured)
    setPaying(true)
    setPayError(null)
    try {
      const fns = getFunctions()
      const createCheckout = httpsCallable<{ token: string }, { url: string }>(fns, 'createStripeCheckout')
      const result = await createCheckout({ token })
      window.location.href = result.data.url
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment unavailable. Please contact us directly.')
      setPaying(false)
    }
  }

  // Print CSS
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'pub-invoice-print'
    style.textContent = `
      @media print {
        .no-print { display: none !important; }
        body { margin: 0; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('pub-invoice-print')?.remove() }
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.cardHead }}>
        <div role="status" aria-label="Loading invoice" style={{ width: 32, height: 32, border: `3px solid ${C.hairline}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.cardHead, fontFamily: PUBLIC_FONT, color: C.inkMuted, padding: 24, textAlign: 'center' }}>
        <PublicGlyph d={ICONS.documentText} size={44} color={C.inkSubtle} />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.ink, margin: '14px 0 4px' }}>Invoice not found</h1>
        <p style={{ fontSize: 14, margin: 0 }}>This link may be invalid or has expired.</p>
      </div>
    )
  }

  const sub = subtotal(invoice)
  const tax = taxAmount(invoice)
  const tot = total(invoice)
  const isPaid = invoice.status === 'paid' || justPaid
  const badge = invoiceBadge(isPaid ? 'paid' : invoice.status, invoice.dueDate)

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: PUBLIC_FONT, padding: '24px 16px 48px' }}>

      {/* Payment success banner */}
      {justPaid && (
        <div style={{ maxWidth: 680, margin: '0 auto 16px', background: C.positiveSoft, border: `1px solid ${C.positiveLine}`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <PublicGlyph d={ICONS.checkCircle} size={20} color="#166534" />
          <div>
            <p style={{ margin: 0, fontWeight: 700, color: '#166534', fontSize: 14 }}>Payment received — thank you!</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#166534' }}>A receipt will be sent to your email if provided.</p>
          </div>
        </div>
      )}

      {/* Print / actions bar */}
      <div className="no-print" style={{ maxWidth: 680, margin: '0 auto 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
        {!isPaid && (
          <button
            onClick={handlePayNow}
            disabled={paying}
            aria-busy={paying}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: paying ? '#6b7280' : C.positive, color: 'white', fontSize: 14, cursor: paying ? 'default' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {paying
              ? <span style={{ width: 13, height: 13, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flex: '0 0 auto' }} />
              : <PublicGlyph d={ICONS.currencyDollar} size={15} color="white" />}
            {paying ? 'Redirecting…' : 'Pay Now'}
          </button>
        )}
        {!isPaid && invoice.financingApplyUrl && isSafeHttpUrl(invoice.financingApplyUrl) && (
          <a
            href={invoice.financingApplyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: '9px 20px', borderRadius: 8, border: `1px solid ${C.accent}`, background: C.card, color: C.accent, fontSize: 14, textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <PublicGlyph d={ICONS.currencyDollar} size={15} />
            {invoice.financingStatus && invoice.financingStatus !== 'created' ? 'View financing application' : 'See financing options'}
          </a>
        )}
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.divider}`, background: C.card, color: C.inkMuted, fontSize: 14, cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <PublicGlyph d={ICONS.printer} size={15} />
          Print
        </button>
      </div>

      {payError && (
        <div role="alert" style={{ maxWidth: 680, margin: '0 auto 12px', background: C.dangerSoft, border: `1px solid ${C.dangerLine}`, borderRadius: 10, padding: '10px 16px' }}>
          <p style={{ margin: 0, fontSize: 14, color: C.danger }}>{payError}</p>
        </div>
      )}

      {/* Invoice document */}
      <div style={{ maxWidth: 680, margin: '0 auto', background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden' }}>

        {/* Header band */}
        <div style={{ background: C.band, padding: '32px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'white', margin: 0 }}>{invoice.coName || 'Invoice'}</h1>
            {invoice.coAddress && <p style={{ fontSize: 13, color: C.onBand, margin: '4px 0 0' }}>{invoice.coAddress}</p>}
            {invoice.coPhone   && <p style={{ fontSize: 13, color: C.onBand, margin: '2px 0 0' }}>{invoice.coPhone}</p>}
            {invoice.coEmail   && <p style={{ fontSize: 13, color: C.onBand, margin: '2px 0 0' }}>{invoice.coEmail}</p>}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: 'white', margin: 0, letterSpacing: '0.04em' }}>INVOICE</p>
            <p style={{ fontSize: 13, color: C.onBand, margin: '4px 0 0', fontFamily: 'monospace' }}>{invoice.invoiceNumber}</p>
            <span style={{ display: 'inline-block', marginTop: 10, padding: '4px 12px', borderRadius: 20, background: badge.bg, color: badge.color, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {badge.label}
            </span>
          </div>
        </div>

        {/* Meta row */}
        <div style={{ padding: '24px 40px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 24, borderBottom: `1px solid ${C.hairline}` }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Bill To</p>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>{invoice.customerName}</p>
            {invoice.customerAddress && <p style={{ fontSize: 13, color: C.inkMuted, margin: '3px 0 0' }}>{invoice.customerAddress}</p>}
            {invoice.customerPhone   && <p style={{ fontSize: 13, color: C.inkMuted, margin: '2px 0 0' }}>{invoice.customerPhone}</p>}
            {invoice.customerEmail   && <p style={{ fontSize: 13, color: C.inkMuted, margin: '2px 0 0' }}>{invoice.customerEmail}</p>}
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Issue Date</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.ink, margin: 0 }}>{fmtPublicDate(invoice.issueDate)}</p>
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Due Date</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.ink, margin: 0 }}>{fmtPublicDate(invoice.dueDate)}</p>
          </div>
        </div>

        {/* Line items */}
        <div style={{ padding: '24px 40px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.hairline}` }}>
                <th style={{ textAlign: 'left', paddingBottom: 8, fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</th>
                <th style={{ textAlign: 'center', paddingBottom: 8, fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.06em', width: 60 }}>Qty</th>
                <th style={{ textAlign: 'right', paddingBottom: 8, fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.06em', width: 100 }}>Rate</th>
                <th style={{ textAlign: 'right', paddingBottom: 8, fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.06em', width: 110 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.rowLine}` }}>
                  <td style={{ padding: '12px 0', fontSize: 14, color: C.ink }}>{item.description || '—'}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, color: C.inkMuted, textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, color: C.inkMuted, textAlign: 'right' }}>{fmtCurrency(item.rate, invoice.currency)}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, fontWeight: 500, color: C.ink, textAlign: 'right' }}>{fmtCurrency(lineItemTotal(item), invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ padding: '0 40px 32px', display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, color: C.inkSubtle, fontSize: 14 }}>
              <span>Subtotal</span><span>{fmtCurrency(sub, invoice.currency)}</span>
            </div>
            {invoice.taxRate > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, color: C.inkSubtle, fontSize: 14 }}>
                <span>Tax ({invoice.taxRate}%)</span><span>{fmtCurrency(tax, invoice.currency)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `2px solid ${C.ink}`, paddingTop: 10, marginTop: 4, fontWeight: 700, fontSize: 20, color: C.ink }}>
              <span>Total</span><span>{fmtCurrency(tot, invoice.currency)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div style={{ padding: '16px 40px', borderTop: `1px solid ${C.hairline}` }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Notes</p>
            <p style={{ fontSize: 13, color: C.inkMuted, whiteSpace: 'pre-wrap', margin: 0 }}>{invoice.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div style={{ background: C.band, padding: '16px 40px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: C.onBand, margin: 0 }}>Thank you for your business!</p>
        </div>
      </div>
    </div>
  )
}
