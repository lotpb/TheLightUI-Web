import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { getPublicInvoice, type PublicInvoiceSnapshot } from '../../services/publicInvoiceService'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { fmtCurrency, lineItemTotal } from '../../models/invoice'
import { isSafeHttpUrl } from '../../utils/safeUrl'

function subtotal(inv: PublicInvoiceSnapshot) {
  return inv.lineItems.reduce((s, l) => s + lineItemTotal(l), 0)
}
function taxAmount(inv: PublicInvoiceSnapshot) {
  return subtotal(inv) * (inv.taxRate / 100)
}
function total(inv: PublicInvoiceSnapshot) {
  return subtotal(inv) + taxAmount(inv)
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function statusInfo(status: string, dueDate: Date) {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const effective = status === 'paid' ? 'paid' : (dueDate < now && status !== 'paid') ? 'overdue' : status
  switch (effective) {
    case 'paid':    return { label: 'PAID',    color: '#16a34a', bg: '#dcfce7' }
    case 'overdue': return { label: 'OVERDUE', color: '#dc2626', bg: '#fee2e2' }
    default:        return { label: 'DUE',     color: '#2563eb', bg: '#dbeafe' }
  }
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif', color: '#64748b' }}>
        <p style={{ fontSize: 48, marginBottom: 12 }}>📄</p>
        <p style={{ fontSize: 18, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>Invoice not found</p>
        <p style={{ fontSize: 14 }}>This link may be invalid or has expired.</p>
      </div>
    )
  }

  const sub = subtotal(invoice)
  const tax = taxAmount(invoice)
  const tot = total(invoice)
  const isPaid = invoice.status === 'paid' || justPaid
  const { label: statusLabel, color: statusColor, bg: statusBg } = statusInfo(isPaid ? 'paid' : invoice.status, invoice.dueDate)

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '24px 16px 48px' }}>

      {/* Payment success banner */}
      {justPaid && (
        <div style={{ maxWidth: 680, margin: '0 auto 16px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div>
            <p style={{ margin: 0, fontWeight: 700, color: '#15803d', fontSize: 14 }}>Payment received — thank you!</p>
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
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: paying ? '#6b7280' : '#16a34a', color: 'white', fontSize: 13, cursor: paying ? 'default' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {paying ? '⏳ Redirecting…' : '💳 Pay Now'}
          </button>
        )}
        {!isPaid && invoice.financingApplyUrl && isSafeHttpUrl(invoice.financingApplyUrl) && (
          <a
            href={invoice.financingApplyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #6366f1', background: 'white', color: '#4f46e5', fontSize: 13, textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            💰 {invoice.financingStatus && invoice.financingStatus !== 'created' ? 'View financing application' : 'See financing options'}
          </a>
        )}
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
        >
          🖨️ Print
        </button>
      </div>

      {payError && (
        <div style={{ maxWidth: 680, margin: '0 auto 12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, padding: '10px 16px' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#dc2626' }}>{payError}</p>
        </div>
      )}

      {/* Invoice document */}
      <div style={{ maxWidth: 680, margin: '0 auto', background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden' }}>

        {/* Header band */}
        <div style={{ background: '#1e293b', padding: '32px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <p style={{ fontSize: 22, fontWeight: 700, color: 'white', margin: 0 }}>{invoice.coName || 'Invoice'}</p>
            {invoice.coAddress && <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>{invoice.coAddress}</p>}
            {invoice.coPhone   && <p style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 0' }}>{invoice.coPhone}</p>}
            {invoice.coEmail   && <p style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 0' }}>{invoice.coEmail}</p>}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: 'white', margin: 0, letterSpacing: '0.04em' }}>INVOICE</p>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0', fontFamily: 'monospace' }}>{invoice.invoiceNumber}</p>
            <span style={{ display: 'inline-block', marginTop: 10, padding: '4px 12px', borderRadius: 20, background: statusBg, color: statusColor, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Meta row */}
        <div style={{ padding: '24px 40px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 24, borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Bill To</p>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', margin: 0 }}>{invoice.customerName}</p>
            {invoice.customerAddress && <p style={{ fontSize: 13, color: '#475569', margin: '3px 0 0' }}>{invoice.customerAddress}</p>}
            {invoice.customerPhone   && <p style={{ fontSize: 13, color: '#475569', margin: '2px 0 0' }}>{invoice.customerPhone}</p>}
            {invoice.customerEmail   && <p style={{ fontSize: 13, color: '#475569', margin: '2px 0 0' }}>{invoice.customerEmail}</p>}
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Issue Date</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>{fmtDate(invoice.issueDate)}</p>
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Due Date</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>{fmtDate(invoice.dueDate)}</p>
          </div>
        </div>

        {/* Line items */}
        <div style={{ padding: '24px 40px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', paddingBottom: 8, fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Description</th>
                <th style={{ textAlign: 'center', paddingBottom: 8, fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', width: 60 }}>Qty</th>
                <th style={{ textAlign: 'right', paddingBottom: 8, fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', width: 100 }}>Rate</th>
                <th style={{ textAlign: 'right', paddingBottom: 8, fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', width: 110 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 0', fontSize: 14, color: '#1e293b' }}>{item.description || '—'}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, color: '#475569', textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, color: '#475569', textAlign: 'right' }}>{fmtCurrency(item.rate, invoice.currency)}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, fontWeight: 500, color: '#1e293b', textAlign: 'right' }}>{fmtCurrency(lineItemTotal(item), invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ padding: '0 40px 32px', display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, color: '#64748b', fontSize: 14 }}>
              <span>Subtotal</span><span>{fmtCurrency(sub, invoice.currency)}</span>
            </div>
            {invoice.taxRate > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, color: '#64748b', fontSize: 14 }}>
                <span>Tax ({invoice.taxRate}%)</span><span>{fmtCurrency(tax, invoice.currency)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #1e293b', paddingTop: 10, marginTop: 4, fontWeight: 700, fontSize: 20, color: '#1e293b' }}>
              <span>Total</span><span>{fmtCurrency(tot, invoice.currency)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div style={{ padding: '16px 40px', borderTop: '1px solid #e2e8f0' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Notes</p>
            <p style={{ fontSize: 13, color: '#475569', whiteSpace: 'pre-wrap', margin: 0 }}>{invoice.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div style={{ background: '#1e293b', padding: '16px 40px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Thank you for your business!</p>
        </div>
      </div>
    </div>
  )
}
