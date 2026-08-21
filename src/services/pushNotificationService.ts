import { getToken, onMessage, type MessagePayload } from 'firebase/messaging'
import { doc, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { db, getMessagingIfSupported } from '../firebase/config'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined

// Tracked so unregisterPush (on sign-out) can remove exactly this device's token.
let currentToken: string | null = null

// Requests permission-independent setup: caller must already have Notification
// permission granted. Registers this device's FCM token on the user doc so
// the onNewChatMessage Cloud Function (and future push senders) can reach it.
export async function registerPush(uid: string): Promise<void> {
  if (!VAPID_KEY) return
  const messaging = await getMessagingIfSupported()
  if (!messaging) return

  const registration = await navigator.serviceWorker.ready
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  }).catch(() => null)
  if (!token) return

  currentToken = token
  await setDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) }, { merge: true })
}

export async function unregisterPush(uid: string): Promise<void> {
  if (!currentToken) return
  await setDoc(doc(db, 'users', uid), { fcmTokens: arrayRemove(currentToken) }, { merge: true }).catch(() => {})
  currentToken = null
}

// Foreground messages don't trigger the browser's native notification UI —
// the app is expected to surface them itself (e.g. via a toast).
export async function listenForegroundMessages(
  callback: (payload: MessagePayload) => void,
): Promise<() => void> {
  const messaging = await getMessagingIfSupported()
  if (!messaging) return () => {}
  return onMessage(messaging, callback)
}
