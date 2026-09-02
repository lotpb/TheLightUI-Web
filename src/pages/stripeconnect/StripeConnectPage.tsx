import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { useAuthStore } from '../../stores/authStore'
import {
    subscribeToStripeConnectStatus,
    connectStripe,
    disconnectStripe,
    type StripeConnectStatus,
} from '../../services/stripeConnectService'

const WEBHOOK_URL = 'https://us-central1-thelightui.cloudfunctions.net/stripeConnectWebhook'

function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function StripeConnectPage() {
    usePageTitle('Stripe Connect')
    const toast = useToast()
    const [searchParams, setSearchParams] = useSearchParams()
    const role = useAuthStore(s => s.role)
    const isAdmin = role === 'owner' || role === 'admin'

    const [status, setStatus] = useState<StripeConnectStatus>({ connected: false, accountId: '', connectedAt: null })
    const [loading, setLoading] = useState(true)
    const [connecting, setConnecting] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)

    useEffect(() => subscribeToStripeConnectStatus(
        s => { setStatus(s); setLoading(false) },
        () => setLoading(false),
    ), [])

    useEffect(() => {
        const connected = searchParams.get('connected')
        if (connected === '1') toast('Stripe account connected', 'success')
        if (connected === '0') toast('Could not connect Stripe', 'error')
        if (connected !== null) {
            searchParams.delete('connected')
            setSearchParams(searchParams, { replace: true })
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    async function handleConnect() {
        setConnecting(true)
        try {
            const url = await connectStripe()
            window.location.href = url
        } catch {
            toast('Could not start the Stripe connection', 'error')
            setConnecting(false)
        }
    }

    async function handleDisconnect() {
        setDisconnecting(true)
        try {
            await disconnectStripe()
            toast('Stripe disconnected', 'success')
        } catch {
            toast('Could not disconnect', 'error')
        } finally {
            setDisconnecting(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white">Stripe Connect</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                    Route customer invoice payments directly to your own bank account
                </p>
            </div>

            <div className="card p-4 mb-6 border-yellow-700/40 bg-yellow-950/20">
                <p className="text-xs text-yellow-300">
                    <strong>Setup required:</strong> create a Connect platform at{' '}
                    <span className="text-yellow-200">dashboard.stripe.com/connect</span>, set its OAuth redirect URI to{' '}
                    <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-yellow-200">
                        https://us-central1-thelightui.cloudfunctions.net/stripeConnectCallback
                    </code>, and configure the <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-yellow-200">STRIPE_CONNECT_CLIENT_ID</code>{' '}
                    Firebase secret before connecting.
                </p>
                <p className="text-xs text-yellow-400/80 mt-2">
                    Also register a <strong>second</strong> webhook endpoint in the Stripe dashboard with "Listen to
                    events on Connected accounts" checked, pointing at{' '}
                    <code className="mx-1 px-1 py-0.5 rounded bg-gray-800 text-yellow-200">{WEBHOOK_URL}</code> — this is
                    separate from the existing invoice payment webhook and uses its own signing secret
                    (<code className="px-1 py-0.5 rounded bg-gray-800">STRIPE_CONNECT_WEBHOOK_SECRET</code>). Skipping
                    this means a connected company's payments will process but never mark the invoice paid.
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
                        Invoice "Pay Now" links now create Checkout Sessions that pay out directly to this Stripe
                        account. No changes needed on individual invoices.
                    </p>
                    {isAdmin ? (
                        <button onClick={handleDisconnect} disabled={disconnecting} className="btn-danger text-sm px-4 py-1.5">
                            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                    ) : (
                        <p className="text-xs text-gray-500">Only owners and admins can change this connection.</p>
                    )}
                </div>
            ) : (
                <div className="card p-5 space-y-4">
                    <p className="text-sm text-gray-400">
                        Not connected — invoice payments currently process through the platform's account rather than
                        yours.
                    </p>
                    {isAdmin ? (
                        <button onClick={handleConnect} disabled={connecting} className="btn-primary text-sm px-4 py-2">
                            {connecting ? 'Redirecting…' : 'Connect Stripe'}
                        </button>
                    ) : (
                        <p className="text-xs text-gray-500">Ask an owner or admin to connect Stripe.</p>
                    )}
                </div>
            )}
        </div>
    )
}
