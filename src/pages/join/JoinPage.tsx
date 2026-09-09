import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { getInvite, redeemInvite } from '../../services/inviteService'
import { useToast } from '../../components/Toast'

export default function JoinPage() {
  const [params] = useSearchParams()
  const code = params.get('code') ?? ''
  /**
   * Set by Login/Register when they send someone straight back here after they
   * chose "Sign In" or "Create Account" on this very invite.
   *
   * Accepting a Team-page invite as a brand-new user used to take two rounds.
   * Registering with no email invitation on file makes onUserCreated hand you
   * your own company as owner, so on returning here your company differed from
   * the invite's and the page asked a second time — behind a warning that you
   * were "in a different company", which is alarming and meaningless to someone
   * who has never used the app. Consent was already given by clicking through
   * the invite, so with this flag the join just happens.
   */
  const autoAccept = params.get('auto') === '1'
  const { user, companyId } = useAuthStore()
  const navigate = useNavigate()
  const toast = useToast()

  const [inviteRole, setInviteRole] = useState<string | null>(null)
  const [inviteCompanyId, setInviteCompanyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) { setError('Invalid invite link.'); setLoading(false); return }
    getInvite(code).then(inv => {
      if (!inv)                               setError('Invite not found.')
      else if (inv.used)                      setError('This invite link has already been used.')
      else if (inv.expiresAt.toDate() < new Date()) setError('This invite link has expired.')
      else { setInviteRole(inv.role); setInviteCompanyId(inv.companyId) }
      setLoading(false)
    }).catch(() => { setError('Failed to load invite.'); setLoading(false) })
  }, [code])

  const handleJoin = useCallback(async () => {
    if (!user) return
    setJoining(true)
    try {
      const { companyId: newCompanyId, role } = await redeemInvite(
        code, user.uid, user.email ?? undefined, user.displayName ?? undefined,
      )
      useAuthStore.setState({ companyId: newCompanyId, role, isReady: true })
      toast(`You've joined as ${role}!`, 'success')
      navigate('/dashboard')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to join', 'error')
    } finally {
      setJoining(false)
    }
  }, [code, user, navigate, toast])

  // Accept on arrival when they came here by clicking through the invite.
  // Guarded by a ref because redeemInvite is single-use: a second call would
  // fail with "already been used", and this effect can re-run as the auth store
  // settles isReady/companyId.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!autoAccept || autoRan.current) return
    if (loading || error || !user || !inviteCompanyId) return
    autoRan.current = true
    handleJoin()
  }, [autoAccept, loading, error, user, inviteCompanyId, handleJoin])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 max-w-sm w-full shadow-2xl text-center">
        <p className="text-5xl mb-5">🏢</p>
        <h1 className="text-xl font-bold text-white mb-2">Company Invite</h1>

        {loading ? (
          <div className="flex justify-center mt-4">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="mt-4">
            <p className="text-red-400 text-sm mb-4">{error}</p>
            <Link to="/dashboard" className="text-indigo-400 text-sm hover:text-indigo-300">← Back to app</Link>
          </div>
        ) : !user ? (
          <div className="mt-2">
            <p className="text-gray-400 text-sm mb-1">You've been invited to join as</p>
            <p className="text-white font-bold text-lg capitalize mb-6">{inviteRole}</p>
            <p className="text-gray-500 text-xs mb-5">Sign in or create an account to accept this invite.</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { sessionStorage.setItem('pendingInviteCode', code); navigate('/login') }}
                className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-colors"
              >
                Sign In
              </button>
              <button
                onClick={() => { sessionStorage.setItem('pendingInviteCode', code); navigate('/register') }}
                className="w-full py-2.5 rounded-xl bg-gray-700 text-white text-sm font-semibold hover:bg-gray-600 transition-colors"
              >
                Create Account
              </button>
            </div>
          </div>
        ) : autoAccept ? (
          // Came straight through the invite, so there's nothing to ask. No
          // "different company" warning either: for a new signup that company
          // is the empty one their registration just created, which is an
          // implementation detail, not something to alarm them about.
          <div className="mt-2">
            <p className="text-gray-400 text-sm mb-1">Joining as</p>
            <p className="text-white font-bold text-2xl capitalize mb-5">{inviteRole}</p>
            <div className="flex justify-center">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-gray-400 text-sm mb-1">You've been invited to join as</p>
            <p className="text-white font-bold text-2xl capitalize mb-2">{inviteRole}</p>
            {/* Only for someone who navigated here under their own steam while
                already in a company — there the switch really is a surprise. */}
            {companyId && companyId !== inviteCompanyId && (
              <p className="text-yellow-400 text-xs mb-4 bg-yellow-500/10 rounded-lg px-3 py-2">
                ⚠️ You're currently in a different company. Accepting will switch your account over.
              </p>
            )}
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full mt-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              {joining ? 'Joining…' : 'Accept & Join'}
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="w-full mt-2 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
