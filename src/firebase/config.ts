import { initializeApp } from 'firebase/app'
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
