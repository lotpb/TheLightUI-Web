import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized, isReady } = useAuthStore()
  const location = useLocation()

  // Waiting for Firebase auth state
  if (!initialized) {
    return <Spinner />
  }

  if (!user) {
    const from = location.pathname + location.search + location.hash
    return <Navigate to="/login" state={{ from }} replace />
  }

  // Waiting for companyId to be resolved (setupAccount may be in-flight)
  if (!isReady) {
    return <Spinner label="Setting up your account…" />
  }

  return <>{children}</>
}

function Spinner({ label }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      {label && <p className="text-sm text-gray-400">{label}</p>}
    </div>
  )
}
