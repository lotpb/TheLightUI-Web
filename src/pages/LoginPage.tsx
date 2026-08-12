import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { usePageTitle } from '../hooks/usePageTitle'

export default function LoginPage() {
  usePageTitle('Sign In')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
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
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      className="input-field pr-10"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      )}
                    </button>
                  </div>
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
