import { useEffect, useState } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { useAuthStore } from '../../stores/authStore'
import {
    subscribeToFinancingStatus,
    connectFinancing,
    disconnectFinancing,
    type FinancingStatus,
} from '../../services/financingService'

const EMPTY_STATUS: FinancingStatus = { connected: false, merchantName: '', sandbox: false, connectedAt: null }

function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function FinancingSettingsPage() {
    usePageTitle('Financing')
    const toast = useToast()
    const role = useAuthStore(s => s.role)
    const isAdmin = role === 'owner' || role === 'admin'

    const [status, setStatus] = useState<FinancingStatus>(EMPTY_STATUS)
    const [loading, setLoading] = useState(true)
    const [apiKey, setApiKey] = useState('')
    const [merchantName, setMerchantName] = useState('')
    const [sandbox, setSandbox] = useState(true)
    const [connecting, setConnecting] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)

    useEffect(() => subscribeToFinancingStatus(
        s => { setStatus(s); setLoading(false) },
        () => setLoading(false),
    ), [])

    async function handleConnect() {
        if (!apiKey.trim()) return
        setConnecting(true)
        try {
            await connectFinancing(apiKey.trim(), merchantName.trim(), sandbox)
            toast('Financing connected', 'success')
            setApiKey('')
        } catch (err) {
            const message = err instanceof Error && err.message ? err.message : 'Could not connect financing'
            toast(message, 'error')
        } finally {
            setConnecting(false)
        }
    }

    async function handleDisconnect() {
        setDisconnecting(true)
        try {
            await disconnectFinancing()
            toast('Financing disconnected', 'success')
        } catch {
            toast('Could not disconnect', 'error')
        } finally {
            setDisconnecting(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white">Financing</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                    Let customers apply for a payment plan on big-ticket proposals and invoices
                </p>
            </div>

            <div className="card p-4 mb-6 border-yellow-700/40 bg-yellow-950/20">
                <p className="text-xs text-yellow-300">
                    <strong>Setup required:</strong> get a merchant API key from your financing provider's dashboard,
                    then paste it below. A loan payout goes directly to your business's own bank account — this key
                    is specific to your company and is never shared with other accounts on this platform.
                </p>
            </div>

            {loading ? (
                <p className="text-sm text-gray-500">Loading…</p>
            ) : status.connected ? (
                <div className="card p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400" />
                        <p className="text-sm font-semibold text-green-300">
                            Connected{status.merchantName && <span className="text-gray-500 font-normal"> — {status.merchantName}</span>}
                        </p>
                        {status.sandbox && (
                            <span className="text-xs bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full font-medium">Sandbox</span>
                        )}
                    </div>
                    {status.connectedAt && (
                        <p className="text-xs text-gray-500">Connected {fmtDate(status.connectedAt)}</p>
                    )}
                    <p className="text-sm text-gray-400">
                        Open a proposal or invoice and use "Get Financing Link" to generate a payment-plan application
                        for the customer to apply through.
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
                    {isAdmin ? (
                        <>
                            <div>
                                <label className="text-xs text-gray-500 block mb-1.5">Merchant API Key</label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={e => setApiKey(e.target.value)}
                                    placeholder="Paste your financing provider's API key"
                                    className="input-field w-full text-sm"
                                    autoComplete="off"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 block mb-1.5">Merchant / Business Name (optional)</label>
                                <input
                                    type="text"
                                    value={merchantName}
                                    onChange={e => setMerchantName(e.target.value)}
                                    placeholder="How this account is labeled with your provider"
                                    className="input-field w-full text-sm"
                                />
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-400">
                                <input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} />
                                Sandbox / test mode
                            </label>
                            <button
                                onClick={handleConnect}
                                disabled={connecting || !apiKey.trim()}
                                className="btn-primary text-sm px-4 py-2"
                            >
                                {connecting ? 'Connecting…' : 'Connect Financing'}
                            </button>
                        </>
                    ) : (
                        <p className="text-xs text-gray-500">Ask an owner or admin to connect financing.</p>
                    )}
                </div>
            )}
        </div>
    )
}
