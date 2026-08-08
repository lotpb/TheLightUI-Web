import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const { signIn, resetPassword, loading, error, clearError, user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    clearError()
    if (resetMode) {
      await resetPassword(email)
      if (!useAuthStore.getState().error) setResetSent(true)
    } else {
      await signIn(email, password)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 bg-gray-950 overflow-y-auto">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">TheLight</h1>
          <p className="text-gray-400 mt-2 text-sm">
            {resetMode ? 'Reset your password' : 'Sign in to your account'}
          </p>
        </div>

        <div className="card p-6">
          {resetSent ? (
            <div className="text-center py-4">
              <div className="text-3xl mb-3">✉</div>
              <p className="text-gray-100 font-medium">Check your email</p>
              <p className="text-gray-400 text-sm mt-1">Password reset link sent to {email}</p>
              <button
                className="mt-4 text-indigo-400 text-sm hover:text-indigo-300"
                onClick={() => { setResetMode(false); setResetSent(false) }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              {!resetMode && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                  <input
                    type="password"
                    className="input-field"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
              )}

              {error && (
                <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2.5">
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full mt-2"
              >
                {loading
                  ? 'Please wait…'
                  : resetMode ? 'Send Reset Link' : 'Sign In'}
              </button>

              <div className="text-center pt-1 space-y-2">
                <div>
                  <button
                    type="button"
                    onClick={() => { setResetMode(!resetMode); clearError(); setResetSent(false) }}
                    className="text-sm text-indigo-400 hover:text-indigo-300"
                  >
                    {resetMode ? 'Back to sign in' : 'Forgot password?'}
                  </button>
                </div>
                {!resetMode && (
                  <div>
                    <span className="text-sm text-gray-400">Don't have an account? </span>
                    <Link to="/register" className="text-sm text-indigo-400 hover:text-indigo-300">
                      Create one
                    </Link>
                  </div>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
