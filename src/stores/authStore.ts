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
import { doc, setDoc, getDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { auth } from '../firebase/config'
import { db } from '../firebase/config'
import { unregisterPush } from '../services/pushNotificationService'

interface AuthState {
  user: User | null
  companyId: string | null
  role: string | null
  firstName: string | null
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
  firstName: null,
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
    userDocUnsub?.()
    userDocUnsub = null
    stopHeartbeat()
    const { user } = useAuthStore.getState()
    if (user) {
      markOffline(user.uid)
      await unregisterPush(user.uid).catch(() => {})
    }
    await fbSignOut(auth)
    set({ companyId: null, role: null, firstName: null, isReady: false })
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

// Cleanup handles
let claimSignalUnsub: (() => void) | null = null
let userDocUnsub: (() => void) | null = null
let presenceHeartbeat: ReturnType<typeof setInterval> | null = null

function markOnline(uid: string) {
  setDoc(doc(db, 'users', uid), { isOnline: true, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {})
}
function markOffline(uid: string) {
  setDoc(doc(db, 'users', uid), { isOnline: false, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {})
}
function startHeartbeat(uid: string) {
  if (presenceHeartbeat) clearInterval(presenceHeartbeat)
  presenceHeartbeat = setInterval(() => markOnline(uid), 2 * 60 * 1000)
}
function stopHeartbeat() {
  if (presenceHeartbeat) { clearInterval(presenceHeartbeat); presenceHeartbeat = null }
}

// Force-refresh the ID token and apply updated claims to the store.
// Triggered by the Firestore claimRefreshSignals/{uid} document changing,
// which the server writes after updating the user's custom claims.
async function refreshClaims(user: User): Promise<void> {
  try {
    await user.getIdToken(/* forceRefresh */ true)
    const fresh = await user.getIdTokenResult()
    const companyId = typeof fresh.claims['companyId'] === 'string' ? fresh.claims['companyId'] : undefined
    if (companyId) {
      // Only update companyId — role is managed by the Firestore userDoc listener
      // so we don't overwrite a Firestore-sourced role with a stale custom claim.
      useAuthStore.setState({ companyId, isReady: true })
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
      useAuthStore.setState({ user: null, companyId: null, role: null, firstName: null, initialized: true, isReady: false })
    }
    return
  }

  useAuthStore.setState({ user, initialized: true })

  try {
    const tokenResult = await user.getIdTokenResult()
    if (generation !== authGeneration) return

    let companyId = typeof tokenResult.claims['companyId'] === 'string' ? tokenResult.claims['companyId'] : undefined
    let role      = typeof tokenResult.claims['role']      === 'string' ? tokenResult.claims['role']      : undefined

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

      if (typeof refreshed.claims['companyId'] === 'string') {
        companyId = refreshed.claims['companyId']
        role = typeof refreshed.claims['role'] === 'string' ? refreshed.claims['role'] : role
      }
    }

    if (generation !== authGeneration) return

    // If claims don't carry a role, read it eagerly from Firestore so the UI
    // has the correct role before the first render (avoids the race where the
    // onSnapshot listener fires too late and role-gated UI is hidden).
    if (!role) {
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid))
        if (userSnap.exists()) {
          const fsRole = userSnap.data()['role']
          if (typeof fsRole === 'string' && fsRole) role = fsRole
        }
      } catch { /* ignore — listener will sync later */ }
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

    // Watch the Firestore user doc for role/companyId changes.
    // This ensures the store stays current even when the setUserRole CF is not deployed
    // (role is written directly to Firestore by teamService.setMemberRole).
    userDocUnsub?.()
    userDocUnsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (!snap.exists()) return
        const d = snap.data() as Record<string, unknown>
        const fsRole      = typeof d['role']      === 'string' ? d['role']      : null
        const fsCompanyId = typeof d['companyId'] === 'string' ? d['companyId'] : null
        const fsFirstName = typeof d['firstName'] === 'string' ? d['firstName'] : null
        const state = useAuthStore.getState()
        if (fsRole && fsRole !== state.role) {
          useAuthStore.setState({ role: fsRole })
        }
        if (fsCompanyId && fsCompanyId !== state.companyId) {
          useAuthStore.setState({ companyId: fsCompanyId, isReady: true })
        }
        if (fsFirstName !== state.firstName) {
          useAuthStore.setState({ firstName: fsFirstName })
        }
      },
      () => {}
    )

    // Sync companyId, email and mark user online.
    if (companyId) {
      const emailUpdate: Record<string, unknown> = { companyId, isOnline: true, lastSeen: serverTimestamp() }
      if (user.email) emailUpdate['email'] = user.email
      setDoc(doc(db, 'users', user.uid), emailUpdate, { merge: true }).catch(() => {})
      startHeartbeat(user.uid)
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
    const companyId = typeof result.claims['companyId'] === 'string' ? result.claims['companyId'] : undefined
    if (companyId && companyId !== useAuthStore.getState().companyId) {
      useAuthStore.setState({ companyId })
    }
  }).catch(() => {})
})

// Mark offline when the tab is closed or navigated away.
window.addEventListener('pagehide', () => {
  const { user } = useAuthStore.getState()
  if (user) markOffline(user.uid)
  stopHeartbeat()
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
