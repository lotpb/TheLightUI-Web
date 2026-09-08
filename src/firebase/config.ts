import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

/**
 * App Check — attests that a request came from this app, rather than from a
 * script holding the project config. That config is public by necessity: it
 * ships in this bundle, so anyone can read it and call the Firestore REST API
 * directly. Security rules still apply to those calls, which is why the rest of
 * the data is safe — but `serviceRequests` and `leadSubmissions` are
 * deliberately `allow create: if true`, because a stranger submitting the
 * public lead form isn't signed in. Rules can't be tightened there without
 * removing the feature; App Check is the missing constraint.
 *
 * Inert until VITE_FIREBASE_APPCHECK_SITE_KEY is set — with no key this is
 * skipped entirely and nothing changes. With a key, the SDK starts attaching an
 * attestation token to every Firebase request, but a token is only *required*
 * once enforcement is switched on per service in the console.
 *
 * Enforcement is project-wide per service, not per client. Turning it on
 * rejects every caller without a valid token, including older iOS builds
 * already on people's phones. Order of operations:
 *
 *   1. deploy this with a site key, enforcement off
 *   2. watch App Check → Metrics until verified traffic dominates
 *   3. ship an iOS build with App Attest and let it roll out
 *   4. only then enforce, one service at a time, Firestore last
 *
 * Note this is a different key from VITE_RECAPTCHA_SITE_KEY, which is plain
 * reCAPTCHA v3 called by hand on /register. App Check needs its own
 * reCAPTCHA Enterprise key.
 *
 * Imported statically rather than behind a dynamic import: App Check has to be
 * initialized before any other Firebase service issues a request, and awaiting
 * a chunk would let those first requests go out untokened.
 */
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY
if (appCheckSiteKey) {
  // Has to be set before initializeAppCheck. In dev the SDK prints a debug
  // token to the console instead of calling reCAPTCHA; register it under
  // App Check → Apps → Manage debug tokens, or localhost is rejected the
  // moment enforcement goes on.
  if (import.meta.env.DEV) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  } catch (err) {
    // A malformed key must not take the whole app down while enforcement is
    // off — without enforcement, requests succeed with or without a token.
    console.error('[AppCheck] initialization failed:', err)
  }
}

export const auth    = getAuth(app)

/**
 * In-memory cache, not IndexedDB persistence.
 *
 * This was persistentLocalCache({ tabManager: persistentMultipleTabManager() }).
 * Multi-tab persistence elects a primary tab to own the IndexedDB lease; if that
 * lease goes stale — a tab left open, a crashed tab, a corrupt local database —
 * the other tabs wait for it and snapshots simply stop arriving. No error is
 * raised, so onSnapshot's error handler never runs and every screen in the app
 * sits on its loading state indefinitely. Because the bad state lives in
 * IndexedDB it also survives a reload, which is what makes it look like a code
 * regression when it isn't one.
 *
 * memoryLocalCache doesn't touch IndexedDB at all, so a poisoned local database
 * can't block reads and there is no lease to contend over. The cost is offline
 * reads and a cold cache on each page load; correctness of a listener that
 * always resolves is worth more than that here.
 *
 * To restore offline support, put persistentLocalCache back — but pair it with
 * a real failure path, because this mode fails silently by design.
 */
export const db = initializeFirestore(app, { localCache: memoryLocalCache() })
export const storage   = getStorage(app)
export const functions = getFunctions(app)

// Messaging isn't available in every browser (e.g. Safari < 16, non-secure
// contexts), so resolve it lazily and cache the one-time support check.
let messagingPromise: Promise<Messaging | null> | null = null
export function getMessagingIfSupported(): Promise<Messaging | null> {
  if (!messagingPromise) {
    messagingPromise = isSupported().then(ok => (ok ? getMessaging(app) : null)).catch(() => null)
  }
  return messagingPromise
}
