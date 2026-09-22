import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicProposal, respondToProposal, type PublicProposalSnapshot } from '../../services/publicProposalService'
import { fmtCurrency, lineItemTotal } from '../../models/proposal'
import { isSafeHttpUrl } from '../../utils/safeUrl'
import {
  PUBLIC_COLORS as C, PUBLIC_FONT, fmtPublicDate, publicBadge,
} from '../../models/publicTheme'
import { PublicGlyph, ICONS } from '../../components/PublicGlyph'

function subtotal(p: PublicProposalSnapshot) {
  return p.lineItems.reduce((s, l) => s + lineItemTotal(l), 0)
}
function taxAmount(p: PublicProposalSnapshot) {
  return subtotal(p) * (p.taxRate / 100)
}
function total(p: PublicProposalSnapshot) {
  return subtotal(p) + taxAmount(p)
}

/**
 * Which badge to show.
 *
 * The local version ended in `default:` returning "AWAITING RESPONSE", so any
 * status the app gains later would be presented to a customer as still open —
 * and it hardcoded four colour pairs measuring 3.00, 3.95, 5.02 and 4.24:1,
 * three of them below AA for an 11px bold label.
 */
function proposalBadge(status: string, expiresDate: Date) {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  if (status === 'sent' && expiresDate instanceof Date && !isNaN(expiresDate.getTime()) && expiresDate < now) {
    return publicBadge('expired')
  }
  return publicBadge(status === 'sent' ? 'due' : status)
}

export default function PublicProposalPage() {
  const { token } = useParams<{ token: string }>()
  const [proposal, setProposal] = useState<PublicProposalSnapshot | null>(null)
  const [loading, setLoading]   = useState(true)
  const [responding, setResponding] = useState(false)
  const [respondError, setRespondError] = useState<string | null>(null)
  /**
   * Which response is awaiting confirmation.
   *
   * Accepting a proposal was one unconfirmed click — the most consequential
   * thing a customer can do in this product, committing them to a priced scope
   * of work, and irreversible from their side since the page then hides the
   * buttons. Declining was the same. Everywhere else in the app a write like
   * this asks first: deactivating a record, deleting a task, deleting an
   * enrolment. This one didn't.
   */
  const [confirming, setConfirming] = useState<'accepted' | 'declined' | null>(null)

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
    setConfirming(null)
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.cardHead }}>
        <div role="status" aria-label="Loading proposal" style={{ width: 32, height: 32, border: `3px solid ${C.hairline}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.cardHead, fontFamily: PUBLIC_FONT, color: C.inkMuted, padding: 24, textAlign: 'center' }}>
        <PublicGlyph d={ICONS.documentText} size={44} color={C.inkSubtle} />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.ink, margin: '14px 0 4px' }}>Proposal not found</h1>
        <p style={{ fontSize: 14, margin: 0 }}>This link may be invalid or has expired.</p>
      </div>
    )
  }

  const sub = subtotal(proposal)
  const tax = taxAmount(proposal)
  const tot = total(proposal)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const isExpired = proposal.status === 'sent' && proposal.expiresDate < now
  const canRespond = proposal.status === 'sent' && !isExpired
  const badge = proposalBadge(proposal.status, proposal.expiresDate)

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: PUBLIC_FONT, padding: '24px 16px 48px' }}>

      {proposal.status === 'accepted' && (
        <div style={{ maxWidth: 680, margin: '0 auto 16px', background: C.positiveSoft, border: `1px solid ${C.positiveLine}`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <PublicGlyph d={ICONS.checkCircle} size={20} color="#166534" />
          <div>
            <p style={{ margin: 0, fontWeight: 700, color: '#166534', fontSize: 14 }}>You accepted this proposal — thank you!</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#166534' }}>We'll be in touch shortly to get started.</p>
          </div>
        </div>
      )}
      {proposal.status === 'declined' && (
        <div style={{ maxWidth: 680, margin: '0 auto 16px', background: C.dangerSoft, border: `1px solid ${C.dangerLine}`, borderRadius: 12, padding: '14px 20px' }}>
          <p style={{ margin: 0, fontWeight: 700, color: C.danger, fontSize: 14 }}>You declined this proposal.</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#991b1b' }}>Reach out if you'd like to discuss further.</p>
        </div>
      )}

      <div className="no-print" style={{ maxWidth: 680, margin: '0 auto 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
        {proposal.financingApplyUrl && isSafeHttpUrl(proposal.financingApplyUrl) && (
          <a
            href={proposal.financingApplyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: '9px 20px', borderRadius: 8, border: `1px solid ${C.accent}`, background: C.card, color: C.accent, fontSize: 14, textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <PublicGlyph d={ICONS.currencyDollar} size={15} />
            {proposal.financingStatus && proposal.financingStatus !== 'created' ? 'View financing application' : 'See financing options'}
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

      {respondError && (
        <div role="alert" style={{ maxWidth: 680, margin: '0 auto 12px', background: C.dangerSoft, border: `1px solid ${C.dangerLine}`, borderRadius: 10, padding: '10px 16px' }}>
          <p style={{ margin: 0, fontSize: 14, color: C.danger }}>{respondError}</p>
        </div>
      )}

      <div style={{ maxWidth: 680, margin: '0 auto', background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden' }}>

        <div style={{ background: C.band, padding: '32px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'white', margin: 0 }}>{proposal.coName || 'Proposal'}</h1>
            {proposal.coAddress && <p style={{ fontSize: 13, color: C.onBand, margin: '4px 0 0' }}>{proposal.coAddress}</p>}
            {proposal.coPhone   && <p style={{ fontSize: 13, color: C.onBand, margin: '2px 0 0' }}>{proposal.coPhone}</p>}
            {proposal.coEmail   && <p style={{ fontSize: 13, color: C.onBand, margin: '2px 0 0' }}>{proposal.coEmail}</p>}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: 'white', margin: 0, letterSpacing: '0.04em' }}>PROPOSAL</p>
            <p style={{ fontSize: 13, color: C.onBand, margin: '4px 0 0', fontFamily: 'monospace' }}>{proposal.proposalNumber}</p>
            <span style={{ display: 'inline-block', marginTop: 10, padding: '4px 12px', borderRadius: 20, background: badge.bg, color: badge.color, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {badge.label}
            </span>
          </div>
        </div>

        <div style={{ padding: '24px 40px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 24, borderBottom: `1px solid ${C.hairline}` }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Prepared For</p>
            <p style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>{proposal.customerName}</p>
            {proposal.customerAddress && <p style={{ fontSize: 13, color: C.inkMuted, margin: '3px 0 0' }}>{proposal.customerAddress}</p>}
            {proposal.customerPhone   && <p style={{ fontSize: 13, color: C.inkMuted, margin: '2px 0 0' }}>{proposal.customerPhone}</p>}
            {proposal.customerEmail   && <p style={{ fontSize: 13, color: C.inkMuted, margin: '2px 0 0' }}>{proposal.customerEmail}</p>}
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Issue Date</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.ink, margin: 0 }}>{fmtPublicDate(proposal.issueDate)}</p>
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Expires</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.ink, margin: 0 }}>{fmtPublicDate(proposal.expiresDate)}</p>
          </div>
        </div>

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
              {proposal.lineItems.map((item, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.rowLine}` }}>
                  <td style={{ padding: '12px 0', fontSize: 14, color: C.ink }}>{item.description || '—'}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, color: C.inkMuted, textAlign: 'center' }}>{item.qty}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, color: C.inkMuted, textAlign: 'right' }}>{fmtCurrency(item.rate)}</td>
                  <td style={{ padding: '12px 0', fontSize: 14, fontWeight: 500, color: C.ink, textAlign: 'right' }}>{fmtCurrency(lineItemTotal(item))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '0 40px 32px', display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, color: C.inkSubtle, fontSize: 14 }}>
              <span>Subtotal</span><span>{fmtCurrency(sub)}</span>
            </div>
            {proposal.taxRate > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, color: C.inkSubtle, fontSize: 14 }}>
                <span>Tax ({proposal.taxRate}%)</span><span>{fmtCurrency(tax)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `2px solid ${C.ink}`, paddingTop: 10, marginTop: 4, fontWeight: 700, fontSize: 20, color: C.ink }}>
              <span>Total</span><span>{fmtCurrency(tot)}</span>
            </div>
          </div>
        </div>

        {proposal.notes && (
          <div style={{ padding: '16px 40px', borderTop: `1px solid ${C.hairline}` }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Notes</p>
            <p style={{ fontSize: 13, color: C.inkMuted, whiteSpace: 'pre-wrap', margin: 0 }}>{proposal.notes}</p>
          </div>
        )}

        {/* Accept / Decline */}
        {canRespond && (
          <div className="no-print" style={{ padding: '20px 40px 32px', borderTop: `1px solid ${C.hairline}` }}>
            {confirming ? (
              <div role="alertdialog" aria-label="Confirm your response" style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: '0 0 4px' }}>
                  {confirming === 'accepted'
                    ? `Accept this proposal for ${fmtCurrency(tot)}?`
                    : 'Decline this proposal?'}
                </p>
                <p style={{ fontSize: 13, color: C.inkSubtle, margin: '0 0 16px' }}>
                  {confirming === 'accepted'
                    ? 'This tells us to go ahead. You can\u2019t undo it here — contact us if you change your mind.'
                    : 'You can\u2019t undo this here. Contact us if you\u2019d like to discuss instead.'}
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setConfirming(null)}
                    disabled={responding}
                    style={{ padding: '11px 24px', borderRadius: 10, border: `1px solid ${C.divider}`, background: C.card, color: C.inkMuted, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Go back
                  </button>
                  <button
                    onClick={() => handleRespond(confirming)}
                    disabled={responding}
                    aria-busy={responding}
                    style={{
                      padding: '11px 28px', borderRadius: 10, border: 'none',
                      background: responding ? '#6b7280' : confirming === 'accepted' ? C.positive : C.danger,
                      color: 'white', fontSize: 15, fontWeight: 700,
                      cursor: responding ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    {responding && (
                      <span style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flex: '0 0 auto' }} />
                    )}
                    {responding
                      ? 'Submitting…'
                      : confirming === 'accepted' ? 'Yes, accept it' : 'Yes, decline it'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setConfirming('declined')}
                  style={{ padding: '11px 28px', borderRadius: 10, border: `1px solid ${C.divider}`, background: C.card, color: C.inkMuted, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
                >
                  Decline
                </button>
                <button
                  onClick={() => setConfirming('accepted')}
                  style={{ padding: '11px 28px', borderRadius: 10, border: 'none', background: C.positive, color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <PublicGlyph d={ICONS.check} size={15} color="white" />
                  Accept Proposal
                </button>
              </div>
            )}
          </div>
        )}
        {isExpired && (
          <div style={{ padding: '16px 40px 28px', borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#78350f', margin: 0 }}>This proposal has expired. Please contact us for an updated quote.</p>
          </div>
        )}

        <div style={{ background: C.band, padding: '16px 40px', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: C.onBand, margin: 0 }}>Thank you for the opportunity to work with you!</p>
        </div>
      </div>
    </div>
  )
}
