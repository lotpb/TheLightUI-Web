import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useToast } from '../../components/Toast'
import { useAuthStore } from '../../stores/authStore'
import {
    subscribeToFacebookStatus,
    connectFacebook,
    setPageSubscription,
    disconnectFacebook,
    type FacebookStatus,
} from '../../services/facebookLeadsService'
import './FacebookLeadsPage.css'

const WEBHOOK_URL = 'https://us-central1-thelightui.cloudfunctions.net/facebookLeadWebhook'

const EMPTY_STATUS: FacebookStatus = {
    connected: false,
    connectedAt: null,
    fbUserName: '',
    availablePages: [],
    subscribedPages: [],
    lastLeadAt: null,
    lastError: '',
    lastErrorAt: null,
    needsReauth: false,
    userTokenExpiresAt: null,
}

function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(d: Date): string {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function FacebookLeadsPage() {
    usePageTitle('Facebook Leads')
    const toast = useToast()
    const [searchParams, setSearchParams] = useSearchParams()
    const role = useAuthStore(s => s.role)
    const isAdmin = role === 'owner' || role === 'admin'

    const [status, setStatus] = useState<FacebookStatus>(EMPTY_STATUS)
    const [loading, setLoading] = useState(true)
    const [connecting, setConnecting] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)
    const [pendingPageId, setPendingPageId] = useState('')

    useEffect(() => subscribeToFacebookStatus(
        s => { setStatus(s); setLoading(false) },
        () => setLoading(false),
    ), [])

    useEffect(() => {
        const connected = searchParams.get('connected')
        if (connected === '1') toast('Connected to Facebook', 'success')
        if (connected === '0') toast('Could not connect to Facebook', 'error')
        if (connected !== null) {
            searchParams.delete('connected')
            setSearchParams(searchParams, { replace: true })
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    async function handleConnect() {
        setConnecting(true)
        try {
            const url = await connectFacebook()
            window.location.href = url
        } catch {
            toast('Could not start the Facebook connection', 'error')
            setConnecting(false)
        }
    }

    async function handleDisconnect() {
        setDisconnecting(true)
        try {
            await disconnectFacebook()
            toast('Disconnected from Facebook', 'success')
        } catch {
            toast('Could not disconnect', 'error')
        } finally {
            setDisconnecting(false)
        }
    }

    async function handleTogglePage(pageId: string, pageName: string, subscribe: boolean) {
        setPendingPageId(pageId)
        try {
            await setPageSubscription(pageId, subscribe)
            toast(subscribe ? `Importing leads from ${pageName}` : `Stopped importing from ${pageName}`, 'success')
        } catch (err) {
            const message = err instanceof Error && err.message ? err.message : 'Could not update that Page'
            toast(message, 'error')
        } finally {
            setPendingPageId('')
        }
    }

    const subscribedIds = new Set(status.subscribedPages.map(p => p.id))

    return (
        <div className="max-w-2xl mx-auto px-4 py-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white">Facebook Leads</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                    Import Facebook Lead Ad submissions automatically
                </p>
            </div>

            <div className="fb-callout">
                <p className="fb-callout-text">
                    <strong>Setup required:</strong> create an app at{' '}
                    <span className="fb-callout-text">developers.facebook.com</span>, add Facebook Login with the
                    redirect URI{' '}
                    <code className="fb-callout-code">
                        https://us-central1-thelightui.cloudfunctions.net/facebookOAuthCallback
                    </code>
                    and a Page webhook for the <code className="fb-callout-code">leadgen</code>
                    field pointing at{' '}
                    <code className="fb-callout-code">{WEBHOOK_URL}</code>. Set the{' '}
                    <code className="fb-callout-code">FACEBOOK_APP_ID</code> /{' '}
                    <code className="fb-callout-code">FACEBOOK_APP_SECRET</code> /{' '}
                    <code className="fb-callout-code">FACEBOOK_WEBHOOK_VERIFY_TOKEN</code>{' '}
                    Firebase secrets before connecting.
                </p>
                <p className="fb-callout-secondary">
                    Meta requires App Review for the <code className="fb-callout-code">leads_retrieval</code> and{' '}
                    <code className="fb-callout-code">pages_manage_metadata</code> permissions. Until that is
                    approved, only users with a role on the Meta app can complete the connection.
                </p>
            </div>

            {status.needsReauth && (
                <div className="fb-reauth-card">
                    <p className="fb-reauth-heading">Reconnection needed</p>
                    <p className="fb-reauth-body">
                        Facebook rejected the stored credentials, so new leads are not being imported. Reconnect to
                        restore the feed.
                    </p>
                    {status.lastError && (
                        <p className="fb-reauth-error">{status.lastError}</p>
                    )}
                </div>
            )}

            {loading ? (
                <p className="text-sm text-gray-500">Loading…</p>
            ) : status.connected ? (
                <div className="card p-5 space-y-5">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className={status.needsReauth ? 'fb-dot-reauth' : 'fb-dot-connected'} />
                            <p className={status.needsReauth ? 'fb-status-reauth' : 'fb-status-connected'}>
                                {status.needsReauth ? 'Connected — action needed' : 'Connected'}
                                {status.fbUserName && <span className="text-gray-500 font-normal"> as {status.fbUserName}</span>}
                            </p>
                        </div>
                        <div className="text-xs text-gray-500 mt-1.5 space-y-0.5">
                            {status.connectedAt && <p>Connected {fmtDate(status.connectedAt)}</p>}
                            {status.userTokenExpiresAt && (
                                <p>Access expires {fmtDate(status.userTokenExpiresAt)} — reconnect before then to avoid a gap.</p>
                            )}
                            <p>
                                {status.lastLeadAt
                                    ? `Last lead received ${fmtDateTime(status.lastLeadAt)}`
                                    : 'No leads received yet.'}
                            </p>
                        </div>
                    </div>

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Pages</p>
                        {status.availablePages.length === 0 ? (
                            <p className="text-sm text-gray-500">
                                No Facebook Pages found on this account. Make sure the connecting user administers the Page
                                that runs your lead ads.
                            </p>
                        ) : (
                            <ul className="divide-y divide-gray-700/50">
                                {status.availablePages.map(page => {
                                    const on = subscribedIds.has(page.id)
                                    const busy = pendingPageId === page.id
                                    return (
                                        <li key={page.id} className="flex items-center justify-between py-2.5 gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm text-gray-200 truncate">{page.name || page.id}</p>
                                                <p className={on ? 'fb-status-active' : 'fb-status-inactive'}>
                                                    {on ? 'Importing leads' : 'Not importing'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleTogglePage(page.id, page.name || page.id, !on)}
                                                disabled={busy || !isAdmin}
                                                className={`${on ? 'fb-btn-secondary' : 'fb-btn-primary'} text-xs px-3 py-1.5 shrink-0`}
                                            >
                                                {busy ? 'Saving…' : on ? 'Turn off' : 'Turn on'}
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>

                    <p className="text-sm text-gray-400">
                        Leads from an enabled Page arrive as new leads tagged <strong>Facebook Lead Ad</strong> and
                        notify the team immediately. They land unassigned — assign one to a salesman to trigger the
                        usual assignment notifications.
                    </p>

                    {isAdmin ? (
                        <div className="flex items-center gap-2">
                            <button onClick={handleConnect} disabled={connecting} className="fb-btn-secondary text-sm px-4 py-1.5">
                                {connecting ? 'Redirecting…' : 'Reconnect'}
                            </button>
                            <button onClick={handleDisconnect} disabled={disconnecting} className="fb-btn-danger text-sm px-4 py-1.5">
                                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                            </button>
                        </div>
                    ) : (
                        <p className="text-xs text-gray-500">Only owners and admins can change this connection.</p>
                    )}
                </div>
            ) : (
                <div className="card p-5 space-y-4">
                    <p className="text-sm text-gray-400">Not connected.</p>
                    {isAdmin ? (
                        <button onClick={handleConnect} disabled={connecting} className="fb-btn-primary text-sm px-4 py-2">
                            {connecting ? 'Redirecting…' : 'Connect to Facebook'}
                        </button>
                    ) : (
                        <p className="text-xs text-gray-500">Ask an owner or admin to connect Facebook.</p>
                    )}
                </div>
            )}
        </div>
    )
}
