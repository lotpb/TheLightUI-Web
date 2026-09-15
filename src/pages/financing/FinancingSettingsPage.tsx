import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { useAuthStore } from '../../stores/authStore'
import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import {
    subscribeToFinancingStatus,
    subscribeToFinancingApplications,
    connectFinancing,
    disconnectFinancing,
    verifyFinancingConnection,
    setFinancingMode,
    type FinancingStatus,
} from '../../services/financingService'
import {
    financingStatusMeta, financingSummary, financingSourceLink,
    type FinancingApplication,
} from '../../models/financingApplication'

const EMPTY_STATUS: FinancingStatus = {
    connected: false, merchantName: '', sandbox: false, connectedAt: null,
    verified: false, verificationError: '', verifiedAt: null, keyTail: '',
}

function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n: number): string {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function FinancingSettingsPage() {
    usePageTitle('Financing')
    const toast = useToast()
    const role = useAuthStore(s => s.role)
    const isAdmin = role === 'owner' || role === 'admin'

    const [status, setStatus] = useState<FinancingStatus>(EMPTY_STATUS)
    const [loading, setLoading] = useState(true)
    const [apps, setApps] = useState<FinancingApplication[]>([])
    const [appsCapped, setAppsCapped] = useState(false)
    const [apiKey, setApiKey] = useState('')
    const [showKey, setShowKey] = useState(false)
    const [merchantName, setMerchantName] = useState('')
    const [sandbox, setSandbox] = useState(true)
    const [connecting, setConnecting] = useState(false)
    const [verifying, setVerifying] = useState(false)
    const [switchingMode, setSwitchingMode] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)
    const [confirmDisconnect, setConfirmDisconnect] = useState(false)

    useEffect(() => subscribeToFinancingStatus(
        s => { setStatus(s); setLoading(false) },
        () => setLoading(false),
    ), [])

    useEffect(() => subscribeToFinancingApplications(
        (rows, capped) => { setApps(rows); setAppsCapped(capped) },
        () => { /* the rules allow this read; a failure just leaves the list empty */ },
    ), [])

    const summary = financingSummary(apps)

    async function handleConnect() {
        if (!apiKey.trim()) return
        setConnecting(true)
        try {
            const { verified, message } = await connectFinancing(apiKey.trim(), merchantName.trim(), sandbox)
            // A key the provider accepted and a key that merely saved are not
            // the same outcome, and the toast used to report both as success.
            toast(
                verified ? 'Financing connected and verified' : `Key saved, but not verified — ${message}`,
                verified ? 'success' : 'error',
            )
            setApiKey('')
            setMerchantName('')
            setSandbox(true)
        } catch (err) {
            const message = err instanceof Error && err.message ? err.message : 'Could not connect financing'
            toast(message, 'error')
        } finally {
            setConnecting(false)
        }
    }

    async function handleVerify() {
        setVerifying(true)
        try {
            const { verified, message } = await verifyFinancingConnection()
            toast(verified ? 'Key verified with the provider' : message, verified ? 'success' : 'error')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not verify', 'error')
        } finally {
            setVerifying(false)
        }
    }

    async function handleSwitchMode(toSandbox: boolean) {
        setSwitchingMode(true)
        try {
            const { verified, message } = await setFinancingMode(toSandbox)
            toast(
                verified
                    ? `Switched to ${toSandbox ? 'sandbox' : 'live'} mode`
                    : `Switched, but not verified — ${message}`,
                verified ? 'success' : 'error',
            )
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not switch mode', 'error')
        } finally {
            setSwitchingMode(false)
        }
    }

    async function handleDisconnect() {
        setConfirmDisconnect(false)
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

    const busy = connecting || verifying || switchingMode || disconnecting

    return (
        <div className="max-w-3xl mx-auto px-4 py-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white">Financing</h1>
                <p className="text-sm text-gray-400 mt-0.5">
                    Let customers apply for a payment plan on big-ticket proposals and invoices
                </p>
            </div>

            {/* bg-yellow-900/20 with a 600 border, matching /stripe-connect.
                This card used bg-yellow-950/20, which is 1.01:1 against the
                card in dark mode — a warning box with no box — and has no
                light-mode rule in index.css, leaving its text at 3.31:1. */}
            <div className="card p-4 mb-6 border-yellow-600/40 bg-yellow-900/20">
                <p className="text-xs text-yellow-300">
                    <strong>Setup required:</strong> get a merchant API key from your provider's dashboard, then
                    paste it below. A loan payout goes directly to your business's own bank account — this key is
                    specific to your company and is never shared with other accounts on this platform.
                </p>
                {/* The caveat was sitting in functions/src/financing.ts, where
                    the only person who can act on it never sees it. */}
                <p className="text-xs text-yellow-300 mt-2">
                    <strong>Integration not yet confirmed:</strong> this connects to{' '}
                    <code className="mx-0.5 px-1 py-0.5 rounded bg-gray-800 text-gray-100">api.wisetack.com</code>{' '}
                    (sandbox:{' '}
                    <code className="mx-0.5 px-1 py-0.5 rounded bg-gray-800 text-gray-100">api-sandbox.wisetack.com</code>),
                    and the endpoint paths, request field names and webhook signature header were written from the
                    general shape this class of provider publishes — <strong>not verified against live docs</strong>.
                    Connect in sandbox first and confirm a real application end to end before going live. Live mode
                    may fail until those are checked.
                </p>
                <p className="text-xs text-yellow-300 mt-2">
                    Webhook endpoint for the provider dashboard:{' '}
                    <code className="mx-0.5 px-1 py-0.5 rounded bg-gray-800 text-gray-100 break-all">
                        https://us-central1-thelightui.cloudfunctions.net/financingWebhook
                    </code>{' '}
                    — it verifies an HMAC-SHA256 signature using the{' '}
                    <code className="px-1 py-0.5 rounded bg-gray-800 text-gray-100">FINANCING_WEBHOOK_SECRET</code>{' '}
                    Firebase secret. Without it, application statuses never update.
                </p>
            </div>

            {loading ? (
                <div className="card p-5 space-y-3 animate-pulse" aria-busy="true" aria-label="Loading">
                    <div className="h-4 w-40 bg-gray-700 rounded" />
                    <div className="h-3 w-56 bg-gray-700/60 rounded" />
                    <div className="h-8 w-28 bg-gray-700/60 rounded-lg" />
                </div>
            ) : status.connected ? (
                <div className="card p-5 space-y-4">
                    {/* Three states, not two: a saved key and a key the
                        provider accepts are different things. */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ring-1 ${
                            status.verified
                                ? 'bg-green-500 ring-green-700'
                                : 'bg-amber-500 ring-amber-700'
                        }`} />
                        <p className={`text-sm font-semibold ${status.verified ? 'text-green-300' : 'text-amber-300'}`}>
                            {status.verified ? 'Connected and verified' : 'Key saved — not verified'}
                        </p>
                        {status.merchantName && (
                            <span className="text-sm text-gray-400">— {status.merchantName}</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            status.sandbox
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-green-500/20 text-green-300'
                        }`}>
                            {status.sandbox ? 'Sandbox' : 'Live'}
                        </span>
                    </div>

                    {!status.verified && status.verificationError && (
                        <div className="bg-amber-900/20 border border-amber-600/40 rounded-lg px-3 py-2">
                            <p className="text-xs text-amber-300">{status.verificationError}</p>
                        </div>
                    )}

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        {/* You could never tell which key was stored: the card
                            showed only an optional, hand-typed merchant name. */}
                        <div>
                            <dt className="text-gray-400">Key on file</dt>
                            <dd className="text-gray-100 font-mono">
                                {status.keyTail ? `•••• ${status.keyTail}` : 'stored before key hints were recorded'}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-gray-400">Connected</dt>
                            <dd className="text-gray-100">
                                {status.connectedAt ? fmtDate(status.connectedAt) : '—'}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-gray-400">Last verified</dt>
                            <dd className="text-gray-100">
                                {status.verifiedAt ? fmtDate(status.verifiedAt) : 'never'}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-gray-400">Mode</dt>
                            <dd className="text-gray-100">{status.sandbox ? 'Sandbox (test)' : 'Live'}</dd>
                        </div>
                    </dl>

                    {/* "Open a proposal or invoice and use Get Financing Link"
                        was prose with nowhere to click. */}
                    <p className="text-sm text-gray-400">
                        Use <strong className="text-gray-200">Get Financing Link</strong> on a{' '}
                        <Link to="/proposals" className="text-indigo-400 hover:text-indigo-300">proposal</Link>{' '}
                        or an{' '}
                        <Link to="/invoices" className="text-indigo-400 hover:text-indigo-300">invoice</Link>{' '}
                        to generate a payment-plan application for the customer.
                    </p>

                    {isAdmin ? (
                        <div className="flex items-center gap-2 flex-wrap">
                            <button
                                onClick={handleVerify}
                                disabled={busy}
                                className="btn-secondary text-sm px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40"
                            >
                                <Icon d={ICONS.refresh} className="w-4 h-4" />
                                {verifying ? 'Testing…' : 'Test connection'}
                            </button>
                            {/* Switching mode used to mean disconnecting — which
                                deletes the key — and re-pasting it. */}
                            <button
                                onClick={() => handleSwitchMode(!status.sandbox)}
                                disabled={busy}
                                className="btn-secondary text-sm px-4 py-1.5 disabled:opacity-40"
                            >
                                {switchingMode
                                    ? 'Switching…'
                                    : `Switch to ${status.sandbox ? 'live' : 'sandbox'}`}
                            </button>
                            <div className="flex-1" />
                            <button
                                onClick={() => setConfirmDisconnect(true)}
                                disabled={busy}
                                className="btn-danger text-sm px-4 py-1.5 disabled:opacity-40"
                            >
                                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                            </button>
                        </div>
                    ) : (
                        <p className="text-xs text-gray-400">Only owners and admins can change this connection.</p>
                    )}
                </div>
            ) : (
                <div className="card p-5 space-y-4">
                    {isAdmin ? (
                        <>
                            <div>
                                <label htmlFor="financing-key" className="text-xs text-gray-400 block mb-1.5">
                                    Merchant API Key
                                </label>
                                <div className="relative">
                                    {/* No reveal, no format hint, and the label
                                        wasn't associated with the field — so
                                        clicking it did nothing and a screen
                                        reader announced an unlabelled box. */}
                                    <input
                                        id="financing-key"
                                        type={showKey ? 'text' : 'password'}
                                        value={apiKey}
                                        onChange={e => setApiKey(e.target.value)}
                                        placeholder="Paste your financing provider's API key"
                                        className="input-field w-full text-sm pr-10 font-mono"
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowKey(v => !v)}
                                        aria-label={showKey ? 'Hide API key' : 'Show API key'}
                                        title={showKey ? 'Hide API key' : 'Show API key'}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                    >
                                        <Icon d={ICONS.eye} className="w-4 h-4" />
                                    </button>
                                </div>
                                <p className="text-xs text-gray-400 mt-1.5">
                                    Checked against the provider before it's saved — a key it rejects isn't stored.
                                </p>
                            </div>
                            <div>
                                <label htmlFor="financing-merchant" className="text-xs text-gray-400 block mb-1.5">
                                    Merchant / Business Name (optional)
                                </label>
                                <input
                                    id="financing-merchant"
                                    type="text"
                                    value={merchantName}
                                    onChange={e => setMerchantName(e.target.value)}
                                    placeholder="How this account is labeled with your provider"
                                    className="input-field w-full text-sm"
                                />
                            </div>
                            <label className="flex items-start gap-2 text-sm text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={sandbox}
                                    onChange={e => setSandbox(e.target.checked)}
                                    className="mt-0.5"
                                />
                                <span>
                                    Sandbox / test mode
                                    <span className="block text-xs text-gray-400">
                                        Recommended first — the integration hasn't been confirmed against the
                                        provider's live API. You can switch to live later without re-pasting the key.
                                    </span>
                                </span>
                            </label>
                            <button
                                onClick={handleConnect}
                                disabled={connecting || !apiKey.trim()}
                                className="btn-primary text-sm px-4 py-2"
                            >
                                {connecting ? 'Verifying…' : 'Connect Financing'}
                            </button>
                        </>
                    ) : (
                        <p className="text-xs text-gray-400">Ask an owner or admin to connect financing.</p>
                    )}
                </div>
            )}

            {/* Applications.
                financingApplications accumulated a document per application,
                with statuses advanced by the webhook, and no page listed it —
                the only view was one card on an individual proposal or
                invoice, so "how many applied, how many were approved, how
                much got funded" was unanswerable from the app. */}
            <section className="mt-8">
                <div className="flex items-baseline justify-between gap-2 mb-3">
                    <h2 className="text-lg font-semibold text-white">Applications</h2>
                    {apps.length > 0 && (
                        <p className="text-xs text-gray-400 tabular-nums">
                            {apps.length} total
                        </p>
                    )}
                </div>

                {appsCapped && (
                    <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-4 py-3 text-yellow-300 text-sm mb-3">
                        Showing the most recent 500 applications only — the totals below are understated.
                    </div>
                )}

                {apps.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        {[
                            { label: 'In progress', value: String(summary.open), sub: fmtMoney(summary.openValue), color: 'text-blue-400' },
                            { label: 'Approved', value: String(summary.won), sub: fmtMoney(summary.wonValue), color: 'text-green-400' },
                            { label: 'Funded', value: fmtMoney(summary.fundedValue), sub: 'paid out', color: 'text-green-400' },
                            { label: 'Declined', value: String(summary.lost), sub: 'or expired', color: 'text-gray-100' },
                        ].map(k => (
                            <div key={k.label} className="card p-4">
                                <p className="card-section-title">{k.label}</p>
                                <p className={`text-lg sm:text-xl font-bold mt-1 truncate ${k.color}`}>{k.value}</p>
                                <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
                            </div>
                        ))}
                    </div>
                )}

                <div className="card divide-y divide-gray-700/50">
                    {apps.length === 0 ? (
                        <div className="px-4 py-10 text-center">
                            <Icon d={ICONS.documentText} className="w-8 h-8 mx-auto text-gray-400 mb-3" />
                            <p className="text-sm text-gray-400">
                                {status.connected
                                    ? 'No applications yet. Generate a financing link from a proposal or invoice.'
                                    : 'Connect financing to start taking payment-plan applications.'}
                            </p>
                        </div>
                    ) : (
                        apps.map(a => {
                            const meta = financingStatusMeta(a.status)
                            return (
                                <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline gap-2 flex-wrap">
                                            <Link
                                                to={financingSourceLink(a)}
                                                className="text-sm font-medium text-gray-100 hover:text-indigo-300 transition-colors truncate"
                                            >
                                                {a.customerName || '—'}
                                            </Link>
                                            <span className="text-xs text-gray-400 capitalize shrink-0">{a.sourceType}</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            {a.createdAt ? fmtDate(a.createdAt) : 'date unknown'}
                                            {a.updatedAt && a.createdAt && a.updatedAt > a.createdAt
                                                && ` · updated ${fmtDate(a.updatedAt)}`}
                                        </p>
                                    </div>
                                    <span className="text-sm font-semibold text-white tabular-nums shrink-0">
                                        {fmtMoney(a.amount)}
                                    </span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${meta.classes}`}>
                                        {meta.label}
                                    </span>
                                    {a.applyUrl && (
                                        <a
                                            href={a.applyUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title="Open the customer's application link"
                                            className="shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors
                                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                        >
                                            <Icon d={ICONS.externalLink} className="w-4 h-4" />
                                            <span className="sr-only">Open the application link for {a.customerName || 'this customer'}</span>
                                        </a>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </section>

            <ConfirmModal
                isOpen={confirmDisconnect}
                message={
                    'Disconnect financing? This deletes the stored merchant API key — the only copy — so reconnecting means fetching it from your provider\'s dashboard again. Existing applications stay, but no new financing links can be generated.'
                }
                confirmLabel="Disconnect"
                onConfirm={handleDisconnect}
                onCancel={() => setConfirmDisconnect(false)}
            />
        </div>
    )
}
