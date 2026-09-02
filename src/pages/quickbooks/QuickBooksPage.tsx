import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import {
  subscribeToQuickBooksStatus,
  connectQuickBooks,
  disconnectQuickBooks,
  type QuickBooksStatus,
} from '../../services/quickbooksService'

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function QuickBooksPage() {
  usePageTitle('QuickBooks')
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [status, setStatus] = useState<QuickBooksStatus>({ connected: false, realmId: '', connectedAt: null })
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => subscribeToQuickBooksStatus(
    s => { setStatus(s); setLoading(false) },
    () => setLoading(false),
  ), [])

  useEffect(() => {
    const connected = searchParams.get('connected')
    if (connected === '1') toast('Connected to QuickBooks', 'success')
    if (connected === '0') toast('Could not connect to QuickBooks', 'error')
    if (connected !== null) {
      searchParams.delete('connected')
      setSearchParams(searchParams, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConnect() {
    setConnecting(true)
    try {
      const url = await connectQuickBooks()
      window.location.href = url
    } catch {
      toast('Could not start QuickBooks connection', 'error')
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await disconnectQuickBooks()
      toast('Disconnected from QuickBooks', 'success')
    } catch {
      toast('Could not disconnect', 'error')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">QuickBooks</h1>
        <p className="text-sm text-gray-500 mt-0.5">Push invoices to QuickBooks Online</p>
      </div>

      <div className="card p-4 mb-6 border-yellow-700/40 bg-yellow-950/20">
        <p className="text-xs text-yellow-300">
          <strong>Setup required:</strong> register an app at{' '}
          <span className="text-yellow-200">developer.intuit.com</span>, set its redirect URI to{' '}
          <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-yellow-200">
            https://us-central1-thelightui.cloudfunctions.net/quickbooksOAuthCallback
          </code>, and configure the <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-yellow-200">QUICKBOOKS_CLIENT_ID</code> /{' '}
          <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-yellow-200">QUICKBOOKS_CLIENT_SECRET</code> Firebase secrets before connecting.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : status.connected ? (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <p className="text-sm font-semibold text-green-300">Connected</p>
          </div>
          {status.connectedAt && (
            <p className="text-xs text-gray-500">Connected {fmtDate(status.connectedAt)}</p>
          )}
          <p className="text-sm text-gray-400">
            Open an invoice and use "Sync to QuickBooks" to push it as a QuickBooks invoice. Re-syncing an
            already-pushed invoice updates the existing QuickBooks record instead of duplicating it.
          </p>
          <button onClick={handleDisconnect} disabled={disconnecting} className="btn-danger text-sm px-4 py-1.5">
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <div className="card p-5 space-y-4">
          <p className="text-sm text-gray-400">Not connected.</p>
          <button onClick={handleConnect} disabled={connecting} className="btn-primary text-sm px-4 py-2">
            {connecting ? 'Redirecting…' : 'Connect to QuickBooks'}
          </button>
        </div>
      )}
    </div>
  )
}
