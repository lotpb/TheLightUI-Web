import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicProposal, respondToProposal, type PublicProposalSnapshot } from '../../services/publicProposalService'
import { fmtCurrency, lineItemTotal } from '../../models/proposal'

function subtotal(p: PublicProposalSnapshot) {
  return p.lineItems.reduce((s, l) => s + lineItemTotal(l), 0)
}
function taxAmount(p: PublicProposalSnapshot) {
  return subtotal(p) * (p.taxRate / 100)
}
function total(p: PublicProposalSnapshot) {
  return subtotal(p) + taxAmount(p)
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function statusInfo(status: string, expiresDate: Date) {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const effective = status === 'sent' && expiresDate < now ? 'expired' : status
  switch (effective) {
    case 'accepted': return { label: 'ACCEPTED', color: '#16a34a', bg: '#dcfce7' }
    case 'declined': return { label: 'DECLINED', color: '#dc2626', bg: '#fee2e2' }
    case 'expired':  return { label: 'EXPIRED',  color: '#b45309', bg: '#fef3c7' }
    default:          return { label: 'AWAITING RESPONSE', color: '#2563eb', bg: '#dbeafe' }
  }
}

export default function PublicProposalPage() {
  const { token } = useParams<{ token: string }>()
  const [proposal, setProposal] = useState<PublicProposalSnapshot | null>(null)
  const [loading, setLoading]   = useState(true)
  const [responding, setResponding] = useState(false)
  const [respondError, setRespondError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Proposal'
    if (!token) { setLoading(false); return }
    getPublicProposal(token)
      .then(p => { setProposal(p); if (p) document.title = `Proposal ${p.proposalNumber}` })
      .finally(() => setLoading(false))
  }, [token])

  async function handleRespond(response: 'accepted' | 'declined') {
    if (!token || !proposal) return
    setResponding(true)
    setRespondError(null)
    try {
      await respondToProposal(token, response)
      setProposal({ ...proposal, status: response })
    } catch {
      setRespondError('Could not submit your response. Please try again or contact us directly.')
    } finally {
      setResponding(false)
    }
  }

  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'pub-proposal-print'
    style.textContent = `
      @media print {
        .no-print { display: none !important; }
        body { margin: 0; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('pub-proposal-print')?.remove() }
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif', color: '#64748b' }}>
        <p style={{ fontSize: 48, marginBottom: 12 }}>📝</p>
        <p style={{ fontSize: 18, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>Proposal not found</p>
        <p style={{ fontSize: 14 }}>This link may be invalid or has expired.</p>
      </div>
    )
  }

  const sub = subtotal(proposal)
  const tax = taxAmount(proposal)
  const tot = total(proposal)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const isExpired = proposal.status === 'sent' && proposal.expiresDate < now
  const canRespond = proposal.status === 'sent' && !isExpired
  const { label: statusLabel, color: statusColor, bg: statusBg } = statusInfo(proposal.status, proposal.expiresDate)

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '24px 16px 48px' }}>

      {proposal.status === 'accepted' && (
        <div style={{ maxWidth: 680, margin: '0 auto 16px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div>
            <p style={{ margin: 0, fontWeight: 700, color: '#15803d', fontSize: 14 }}>You accepted this proposal — thank you!</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#166534' }}>We'll be in touch shortly to get started.</p>
          </div>
        </div>
      )}
      {proposal.status === 'declined' && (
        <div style={{ maxWidth: 680, margin: '0 auto 16px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 12, padding: '14px 20px' }}>
          <p style={{ margin: 0, fontWeight: 700, color: '#b91c1c', fontSize: 14 }}>You declined this proposal.</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#991b1b' }}>Reach out if you'd like to discuss further.</p>
        </div>
      )}

      <div className="no-print" style={{ maxWidth: 680, margin: '0 auto 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
        >
          🖨️ Print
        </button>
      </div>

      {respondError && (
        <div style={{ maxWidth: 680, margin: '0 auto 12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, padding: '10px 16px' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#dc2626' }}>{respondError}</p>
        </div>
      )}

      <div style={{ maxWidth: 680, margin: '0 auto', background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden' }}>

        <div style={{ background: '#1e293b', padding: '32px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <p style={{ fontSize: 22, fontWeight: 700, color: 'white', margin: 0 }}>{proposal.coName || 'Proposal'}</p>
            {proposal.coAddress && <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>{proposal.coAddress}</p>}
            {proposal.coPhone   && <p style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 0' }}>{proposal.coPhone}</p>}
            {proposal.coEmail   && <p style={{ fontSize: 13, color: '#94a3b8', margin: '2px 0 0' }}>{proposal.coEmail}</p>}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: 'white', margin: 0, letterSpacing: '0.04em' }}>PROPOSAL</p>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0', fontFamily: 'monospace' }}>{proposal.proposalNumber}</p>
            <span style={{ display: 'inline-block', marginTop: 10, padding: '4px 12px', borderRadius: 20, background: statusBg, color: statusColor, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>
              {statusLabel}
            </span>
          </div>
        </div>

        <div style={{ padding: '24px 40px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 24, borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Prepared For</p>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', margin: 0 }}>{proposal.customerName}</p>
            {proposal.customerAddress && <p style={{ fontSize: 13, color: '#475569', margin: '3px 0 0' }}>{proposal.customerAddress}</p>}
            {proposal.customerPhone   && <p style={{ fontSize: 13, color: '#475569', margin: '2px 0 0' }}>{proposal.customerPhone}</p>}
            {proposal.customerEmail   && <p style={{ fontSize: 13, color: '#475569', margin: '2px 0 0' }}>{proposal.customerEmail}</p>}
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Issue Date</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>{fmtDate(proposal.issueDate)}</p>
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Expires</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', margin: 0 }}>{fmtDate(proposal.expiresDate)}</p>
          </div>
        </div>

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
              {proposal.lineItems.map((item, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 0', fontSize: 14, color: '#1e293b' }}>{item.description || '—'}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, color: '#475569', textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, color: '#475569', textAlign: 'right' }}>{fmtCurrency(item.rate)}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, fontWeight: 500, color: '#1e293b', textAlign: 'right' }}>{fmtCurrency(lineItemTotal(item))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '0 40px 32px', display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, color: '#64748b', fontSize: 14 }}>
              <span>Subtotal</span><span>{fmtCurrency(sub)}</span>
            </div>
            {proposal.taxRate > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, color: '#64748b', fontSize: 14 }}>
                <span>Tax ({proposal.taxRate}%)</span><span>{fmtCurrency(tax)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #1e293b', paddingTop: 10, marginTop: 4, fontWeight: 700, fontSize: 20, color: '#1e293b' }}>
              <span>Total</span><span>{fmtCurrency(tot)}</span>
            </div>
          </div>
        </div>

        {proposal.notes && (
          <div style={{ padding: '16px 40px', borderTop: '1px solid #e2e8f0' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Notes</p>
            <p style={{ fontSize: 13, color: '#475569', whiteSpace: 'pre-wrap', margin: 0 }}>{proposal.notes}</p>
          </div>
        )}

        {/* Accept / Decline */}
        {canRespond && (
          <div className="no-print" style={{ padding: '20px 40px 32px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => handleRespond('declined')}
              disabled={responding}
              style={{ padding: '11px 28px', borderRadius: 10, border: '1px solid #cbd5e1', background: 'white', color: '#64748b', fontSize: 14, fontWeight: 600, cursor: responding ? 'default' : 'pointer' }}
            >
              Decline
            </button>
            <button
              onClick={() => handleRespond('accepted')}
              disabled={responding}
              style={{ padding: '11px 28px', borderRadius: 10, border: 'none', background: responding ? '#6b7280' : '#16a34a', color: 'white', fontSize: 14, fontWeight: 700, cursor: responding ? 'default' : 'pointer' }}
            >
              {responding ? 'Submitting…' : '✓ Accept Proposal'}
            </button>
          </div>
        )}
        {isExpired && (
          <div style={{ padding: '16px 40px 28px', borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#b45309', margin: 0 }}>This proposal has expired. Please contact us for an updated quote.</p>
          </div>
        )}

        <div style={{ background: '#1e293b', padding: '16px 40px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Thank you for the opportunity to work with you!</p>
        </div>
      </div>
    </div>
  )
}
