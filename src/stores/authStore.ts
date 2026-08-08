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
import { auth } from '../firebase/config'

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

// Listen to auth state changes, resolve companyId via custom claims or setupAccount
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    useAuthStore.setState({ user: null, companyId: null, role: null, initialized: true, isReady: false })
    return
  }

  useAuthStore.setState({ user, initialized: true })

  try {
    const tokenResult = await user.getIdTokenResult()
    let companyId = tokenResult.claims['companyId'] as string | undefined
    let role = tokenResult.claims['role'] as string | undefined

    if (!companyId) {
      // Existing user predating multi-tenancy — create their company now
      const fns = getFunctions()
      const setupAccount = httpsCallable<object, { companyId: string; role: string }>(fns, 'setupAccount')
      const result = await setupAccount({})
      companyId = result.data.companyId
      role = result.data.role
      // Force a token refresh so the new claims are embedded in the JWT.
      // Then re-read to confirm — custom claims can take a moment to propagate.
      await user.getIdToken(true)
      const refreshed = await user.getIdTokenResult()
      if (refreshed.claims['companyId']) {
        companyId = refreshed.claims['companyId'] as string
        role = refreshed.claims['role'] as string
      }
    }

    useAuthStore.setState({ companyId: companyId ?? null, role: role ?? null, isReady: true })
  } catch (err) {
    console.error('[Auth] companyId setup failed:', err)
    useAuthStore.setState({ isReady: false })
  }
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
