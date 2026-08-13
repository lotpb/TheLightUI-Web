import { create } from 'zustand'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { auth } from '../firebase/config'
import { db } from '../firebase/config'

interface AuthState {
  user: User | null
  companyId: string | null
  role: string | null
  loading: boolean
  error: string | null
  initialized: boolean  // true once auth state is known (logged in or out)
  isReady: boolean      // true once user + companyId are both available
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  companyId: null,
  role: null,
  loading: false,
  error: null,
  initialized: false,
  isReady: false,

  signIn: async (email, password) => {
    set({ loading: true, error: null })
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign in failed'
      set({ error: friendlyAuthError(msg) })
    } finally {
      set({ loading: false })
    }
  },

  signUp: async (email, password) => {
    set({ loading: true, error: null })
    try {
      await createUserWithEmailAndPassword(auth, email, password)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed'
      set({ error: friendlyAuthError(msg) })
    } finally {
      set({ loading: false })
    }
  },

  signOut: async () => {
    claimSignalUnsub?.()
    claimSignalUnsub = null
    await fbSignOut(auth)
    set({ companyId: null, role: null, isReady: false })
  },

  resetPassword: async (email) => {
    set({ loading: true, error: null })
    try {
      await sendPasswordResetEmail(auth, email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reset failed'
      set({ error: friendlyAuthError(msg) })
    } finally {
      set({ loading: false })
    }
  },

  clearError: () => set({ error: null }),
}))

// Non-hook helper — lets services read companyId without React context
export function getCompanyId(): string {
  return useAuthStore.getState().companyId ?? ''
}

// Cleanup handle for the per-user Firestore claim-refresh signal watcher.
let claimSignalUnsub: (() => void) | null = null

// Force-refresh the ID token and apply updated claims to the store.
// Triggered by the Firestore claimRefreshSignals/{uid} document changing,
// which the server writes after updating the user's custom claims.
async function refreshClaims(user: User): Promise<void> {
  try {
    await user.getIdToken(/* forceRefresh */ true)
    const fresh = await user.getIdTokenResult()
    const companyId = fresh.claims['companyId'] as string | undefined
    const role     = fresh.claims['role']      as string | undefined
    if (companyId) {
      useAuthStore.setState({ companyId, role: role ?? null, isReady: true })
    }
  } catch {
    // Network error — stale claims remain; user can refresh the page to retry
  }
}

// Generation counter: each new auth-state callback captures the current value
// and bails out if a newer callback has already superseded it.
let authGeneration = 0

// Listen to auth state changes, resolve companyId via custom claims or setupAccount
onAuthStateChanged(auth, async (user) => {
  authGeneration++
  const generation = authGeneration

  if (!user) {
    if (generation === authGeneration) {
      useAuthStore.setState({ user: null, companyId: null, role: null, initialized: true, isReady: false })
    }
    return
  }

  useAuthStore.setState({ user, initialized: true })

  try {
    const tokenResult = await user.getIdTokenResult()
    if (generation !== authGeneration) return

    let companyId = tokenResult.claims['companyId'] as string | undefined
    let role = tokenResult.claims['role'] as string | undefined

    if (!companyId) {
      // Existing user predating multi-tenancy — create their company now
      const fns = getFunctions()
      const setupAccount = httpsCallable<object, { companyId: string; role: string }>(fns, 'setupAccount')
      const result = await setupAccount({})
      if (generation !== authGeneration) return

      companyId = result.data.companyId
      role = result.data.role
      // Force a token refresh so the new claims are embedded in the JWT.
      // Then re-read to confirm — custom claims can take a moment to propagate.
      await user.getIdToken(true)
      const refreshed = await user.getIdTokenResult()
      if (generation !== authGeneration) return

      if (refreshed.claims['companyId']) {
        companyId = refreshed.claims['companyId'] as string
        role = refreshed.claims['role'] as string
      }
    }

    if (generation !== authGeneration) return
    useAuthStore.setState({ companyId: companyId ?? null, role: role ?? null, isReady: true })

    // Watch claimRefreshSignals/{uid} so that any server-side claims update
    // (e.g., team invite while the user is already logged in) is picked up
    // immediately without requiring a manual re-login.
    claimSignalUnsub?.()
    claimSignalUnsub = onSnapshot(
      doc(db, 'claimRefreshSignals', user.uid),
      () => { refreshClaims(user) },
      () => {}  // ignore errors (doc may not exist until first invite)
    )

    // Sync companyId to the Firestore user document. Old iOS clients wrote the
    // user doc without merge, erasing the companyId set by onUserCreated.
    // This ensures every web login repairs the document.
    if (companyId) {
      setDoc(doc(db, 'users', user.uid), { companyId }, { merge: true }).catch(() => {})
    }
  } catch (err) {
    if (generation !== authGeneration) return
    console.error('[Auth] companyId setup failed:', err)
    useAuthStore.setState({ isReady: false })
  }
})

// On tab focus: re-read the cached token to apply claims that refreshed
// naturally while the tab was in the background (no forced network call).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  const { user } = useAuthStore.getState()
  if (!user) return
  user.getIdTokenResult().then(result => {
    const companyId = result.claims['companyId'] as string | undefined
    const role      = result.claims['role']      as string | undefined
    if (companyId && companyId !== useAuthStore.getState().companyId) {
      useAuthStore.setState({ companyId, role: role ?? null })
    }
  }).catch(() => {})
})

function friendlyAuthError(msg: string): string {
  if (msg.includes('wrong-password') || msg.includes('invalid-credential')) return 'Incorrect email or password.'
  if (msg.includes('user-not-found')) return 'No account found with that email.'
  if (msg.includes('email-already-in-use')) return 'An account with this email already exists.'
  if (msg.includes('weak-password')) return 'Password must be at least 6 characters.'
  if (msg.includes('too-many-requests')) return 'Too many attempts. Try again later.'
  if (msg.includes('network-request-failed')) return 'Network error. Check your connection.'
  return msg
}
