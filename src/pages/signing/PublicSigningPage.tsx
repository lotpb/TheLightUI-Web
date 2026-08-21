import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getSigningRequest, signDocument } from '../../services/signingRequestService'
import { KIND_LABELS } from '../../models/docTemplate'
import type { SigningRequest } from '../../models/signingRequest'

type Phase = 'loading' | 'not-found' | 'already-signed' | 'ready' | 'submitting' | 'success'

export default function PublicSigningPage() {
  const { token } = useParams<{ token: string }>()
  const [phase,     setPhase]     = useState<Phase>('loading')
  const [request,   setRequest]   = useState<SigningRequest | null>(null)
  const [hasDrawn,  setHasDrawn]  = useState(false)
  const [signerName, setSignerName] = useState('')
  const [error,     setError]     = useState('')

  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const isDrawing   = useRef(false)
  const lastPt      = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!token) { setPhase('not-found'); return }
    getSigningRequest(token)
      .then(req => {
        if (!req) { setPhase('not-found'); return }
        setRequest(req)
        setSignerName(req.document.customerName)
        setPhase(req.status === 'signed' ? 'already-signed' : 'ready')
      })
      .catch(() => setPhase('not-found'))
  }, [token])

  // Scale canvas to devicePixelRatio for crisp rendering
  useEffect(() => {
    if (phase !== 'ready') return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    canvas.width  = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
  }, [phase])

  function getXY(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      if (!t) return null
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const pt = getXY(e)
    if (!pt) return
    isDrawing.current = true
    lastPt.current    = pt
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(pt.x, pt.y)
  }, [])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current) return
    const pt = getXY(e)
    if (!pt) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const lp = lastPt.current ?? pt
    ctx.beginPath()
    ctx.moveTo(lp.x, lp.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    lastPt.current = pt
    setHasDrawn(true)
  }, [])

  const endDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    isDrawing.current = false
    lastPt.current    = null
  }, [])

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  async function handleSubmit() {
    if (!token || !request) return
    if (!hasDrawn) { setError('Please draw your signature above.'); return }
    if (!signerName.trim()) { setError('Please enter your full name.'); return }
    const canvas = canvasRef.current
    if (!canvas) return
    setError('')
    setPhase('submitting')
    try {
      const dataUrl = canvas.toDataURL('image/png')
      await signDocument(token, dataUrl, signerName.trim())
      setPhase('success')
    } catch {
      setError('Something went wrong. Please try again.')
      setPhase('ready')
    }
  }

  if (phase === 'loading') return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 20px' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #4f46e5', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )

  if (phase === 'not-found') return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 500, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <p style={{ fontSize: 40, margin: '0 0 16px' }}>🔍</p>
        <p style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>Document Not Found</p>
        <p style={{ fontSize: 15, color: '#64748b', margin: 0 }}>This signing link may be invalid or has expired.</p>
      </div>
    </div>
  )

  if (phase === 'success') return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 500, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <p style={{ fontSize: 56, margin: '0 0 16px' }}>✅</p>
        <p style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>Document Signed!</p>
        <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 24px' }}>
          Thank you, {signerName}. Your signature has been recorded and the document is now complete.
        </p>
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '16px 20px' }}>
          <p style={{ fontSize: 13, color: '#16a34a', margin: 0 }}>A copy of this agreement is on file with {request?.document.companyName || 'the company'}.</p>
        </div>
      </div>
    </div>
  )

  if (!request) return null
  const d = request.document
  const alreadySigned = phase === 'already-signed'

  const signedDate = request.signedAt?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    ?? new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div style={pageStyle}>
      {/* Branded banner */}
      <div style={{ background: '#4f46e5', padding: '16px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✍</span>
          </div>
          <div>
            <p style={{ color: 'white', fontWeight: 700, fontSize: 15, margin: 0 }}>Electronic Signature Request</p>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, margin: 0 }}>
              From {d.companyName || 'The Company'} · {KIND_LABELS[d.templateKind]}
            </p>
          </div>
          {alreadySigned && (
            <div style={{ marginLeft: 'auto', background: '#22c55e', color: 'white', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 100 }}>
              ✓ Signed
            </div>
          )}
        </div>
      </div>

      {/* Document */}
      <div style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px 80px' }}>
        <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 4px 32px rgba(0,0,0,0.08)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>

          {/* Doc header */}
          <div style={{ background: '#1e293b', padding: '28px 36px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <p style={{ color: 'white', fontSize: 18, fontWeight: 700, margin: 0 }}>{d.companyName || 'Company'}</p>
                {d.companyAddress && <p style={{ color: '#94a3b8', fontSize: 13, margin: '3px 0 0' }}>{d.companyAddress}</p>}
                {d.companyPhone && <p style={{ color: '#94a3b8', fontSize: 13, margin: '2px 0 0' }}>{d.companyPhone}</p>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
                  {KIND_LABELS[d.templateKind]}
                </p>
                <p style={{ color: 'white', fontSize: 18, fontWeight: 700, margin: '4px 0 0' }}>{d.templateName}</p>
                <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 0' }}>Date: {today}</p>
              </div>
            </div>
          </div>

          {/* Doc body */}
          <div style={{ padding: '32px 36px' }}>

            {/* Prepared for */}
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
                Prepared For
              </p>
              <p style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>{d.customerName}</p>
              {d.customerStreet && <p style={{ fontSize: 13, color: '#475569', margin: '3px 0 0' }}>{d.customerStreet}</p>}
              {(d.customerCity || d.customerState) && (
                <p style={{ fontSize: 13, color: '#475569', margin: '2px 0 0' }}>
                  {[d.customerCity, d.customerState, d.customerZip].filter(Boolean).join(', ')}
                </p>
              )}
              {d.customerEmail && <p style={{ fontSize: 13, color: '#475569', margin: '2px 0 0' }}>{d.customerEmail}</p>}
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', margin: '0 0 24px' }} />

            {/* Intro */}
            {d.intro && (
              <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: '0 0 24px', whiteSpace: 'pre-wrap' }}>{d.intro}</p>
            )}

            {/* Sections */}
            {d.sections.map((sec, i) => (
              <div key={i} style={{ marginBottom: 24 }}>
                {sec.heading && (
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
                    {sec.heading}
                  </p>
                )}
                {sec.body && (
                  <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{sec.body}</p>
                )}
              </div>
            ))}

            {/* Closing */}
            {d.closing && (
              <>
                <div style={{ borderTop: '1px solid #e2e8f0', margin: '0 0 24px' }} />
                <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.8, margin: '0 0 24px', whiteSpace: 'pre-wrap' }}>{d.closing}</p>
              </>
            )}

            {/* Signature area */}
            <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: 28 }}>
              {alreadySigned ? (
                // Already signed — show recorded signature
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 16px' }}>
                    Electronic Signature
                  </p>
                  <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      {request.signatureDataUrl && (
                        <img
                          src={request.signatureDataUrl}
                          alt="Signature"
                          style={{ maxHeight: 70, maxWidth: '100%', objectFit: 'contain', display: 'block', marginBottom: 8 }}
                        />
                      )}
                      <div style={{ borderTop: '1px solid #cbd5e1', paddingTop: 6 }}>
                        <p style={{ fontSize: 13, color: '#334155', fontWeight: 600, margin: 0 }}>{request.signerName}</p>
                        <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>Customer Signature</p>
                      </div>
                    </div>
                    <div style={{ width: 160 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#334155', margin: '0 0 6px' }}>{signedDate}</p>
                      <div style={{ borderTop: '1px solid #cbd5e1', paddingTop: 6 }}>
                        <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>Date Signed</p>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 16, padding: '10px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
                    <p style={{ fontSize: 13, color: '#16a34a', margin: 0 }}>✓ This document was electronically signed on {signedDate}.</p>
                  </div>
                </>
              ) : (
                // Ready to sign
                <>
                  <p style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>Sign Here</p>
                  <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
                    Draw your signature in the box below, then enter your full name and click Submit.
                  </p>

                  {/* Canvas */}
                  <div style={{ border: '2px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fafafa', marginBottom: 16, position: 'relative' }}>
                    <canvas
                      ref={canvasRef}
                      style={{ display: 'block', width: '100%', height: 130, cursor: 'crosshair', touchAction: 'none' }}
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={endDraw}
                      onMouseLeave={endDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={endDraw}
                    />
                    {!hasDrawn && (
                      <p style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 13, color: '#cbd5e1', pointerEvents: 'none', margin: 0, whiteSpace: 'nowrap' }}>
                        ✍ Draw signature here
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={clearCanvas}
                    style={{ fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 16px', textDecoration: 'underline' }}
                  >
                    Clear
                  </button>

                  {/* Name confirmation */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                      Full Name (type to confirm)
                    </label>
                    <input
                      type="text"
                      value={signerName}
                      onChange={e => setSignerName(e.target.value)}
                      placeholder="Your full name"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: 14, border: '1.5px solid #e2e8f0', borderRadius: 8, outline: 'none', background: 'white', color: '#0f172a' }}
                    />
                  </div>

                  {error && (
                    <p style={{ fontSize: 13, color: '#dc2626', margin: '0 0 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' }}>
                      {error}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={phase === 'submitting'}
                    style={{
                      width: '100%',
                      padding: '14px',
                      background: phase === 'submitting' ? '#a5b4fc' : '#4f46e5',
                      color: 'white',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: phase === 'submitting' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {phase === 'submitting' ? 'Submitting…' : 'Submit Signature'}
                  </button>

                  <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: '12px 0 0' }}>
                    By submitting, you agree that this electronic signature is legally binding.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 24 }}>
          Secure e-signature powered by TheLightUI
        </p>
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f8fafc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
