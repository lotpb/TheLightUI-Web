/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * reCAPTCHA Enterprise site key for Firebase App Check. Leave unset to skip
   * App Check entirely — see src/firebase/config.ts for the rollout order.
   */
  readonly VITE_FIREBASE_APPCHECK_SITE_KEY?: string
}

/**
 * Read by the Firebase App Check SDK at runtime; it isn't part of the SDK's own
 * type surface. Setting it before initializeAppCheck makes the SDK mint a debug
 * token — printed to the console, for registering in the Firebase console —
 * instead of calling reCAPTCHA, which cannot verify localhost.
 */
declare var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined
