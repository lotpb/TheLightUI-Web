import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a session may sit idle before it is signed out. */
export const IDLE_LIMIT_MS = 30 * 60 * 1000

/** How long before expiry the "still there?" warning appears. */
export const IDLE_WARNING_MS = 2 * 60 * 1000

/** Set on expiry so LoginPage can explain why the user landed there. Per-tab. */
export const IDLE_SIGNOUT_KEY = 'thelight.session.idleSignOut'

// Shared across tabs so that working in one tab doesn't let a second, idle tab
// expire the session out from under it.
const ACTIVITY_KEY = 'thelight.session.lastActivity'

// Writing to localStorage on every keypress is wasteful — 10s resolution is
// plenty against a 30-minute limit.
const WRITE_THROTTLE_MS = 10_000

const TICK_MS = 1_000

// 'scroll' doesn't bubble from nested containers, hence capture: true below.
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

// Authoritative for this tab. localStorage is only the cross-tab channel, so a
// browser that refuses storage (Safari Private Browsing) still gets a working
// timer — it just won't coordinate with sibling tabs.
let memoryLastActivity = Date.now()

function readLastActivity(): number {
  let stored = 0
  try {
    const parsed = Number(localStorage.getItem(ACTIVITY_KEY))
    if (Number.isFinite(parsed)) stored = parsed
  } catch { /* storage unavailable — the in-memory value governs */ }
  return Math.max(memoryLastActivity, stored)
}

function writeLastActivity(at: number) {
  try { localStorage.setItem(ACTIVITY_KEY, String(at)) } catch { /* ignore */ }
}

interface IdleTimeout {
  /** Milliseconds until sign-out, non-null only while the warning is showing. */
  msRemaining: number | null
  /** "Stay signed in" — resets the clock for every tab immediately. */
  stayActive: () => void
}

/**
 * Signs the user out after IDLE_LIMIT_MS without interaction, warning them
 * IDLE_WARNING_MS beforehand.
 *
 * This is a walk-away control: it stops an unattended browser from leaving
 * customer data on screen. It is not a defense against someone who already
 * controls the machine — the Firebase ID token stays valid for up to an hour
 * regardless, so real enforcement belongs in security rules (auth_time) or
 * server-side refresh-token revocation.
 */
export function useIdleTimeout(enabled: boolean, onExpire: () => void): IdleTimeout {
  const [msRemaining, setMsRemaining] = useState<number | null>(null)

  const warningRef   = useRef(false)
  const expiredRef   = useRef(false)
  const lastWriteRef = useRef(0)

  const onExpireRef = useRef(onExpire)
  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])

  const stayActive = useCallback(() => {
    const now = Date.now()
    memoryLastActivity = now
    lastWriteRef.current = now
    writeLastActivity(now)     // write through so other tabs drop their warning too
    warningRef.current = false
    setMsRemaining(null)
  }, [])

  useEffect(() => {
    if (!enabled) {
      warningRef.current = false
      expiredRef.current = false
      setMsRemaining(null)
      return
    }

    // Start the clock fresh on mount. A page load is a deliberate visit by
    // someone at the keyboard, so a stale timestamp from a previous session
    // (browser closed overnight without signing out) must not expire them
    // before they've seen a single screen.
    const mountedAt = Date.now()
    memoryLastActivity = mountedAt
    lastWriteRef.current = mountedAt
    writeLastActivity(mountedAt)

    function tick() {
      const remaining = IDLE_LIMIT_MS - (Date.now() - readLastActivity())

      if (remaining <= 0) {
        if (expiredRef.current) return    // don't fire sign-out twice
        expiredRef.current = true
        warningRef.current = false
        setMsRemaining(null)
        onExpireRef.current()
        return
      }

      if (remaining <= IDLE_WARNING_MS) {
        warningRef.current = true
        setMsRemaining(remaining)
      } else if (warningRef.current) {
        // Another tab saw activity — stand down.
        warningRef.current = false
        setMsRemaining(null)
      }
    }

    function onActivity() {
      // While the warning is up the countdown is authoritative: only the
      // explicit button extends the session, so the dialog can't vanish
      // under a stray mouse movement before it's been read.
      if (warningRef.current || expiredRef.current) return

      const now = Date.now()
      memoryLastActivity = now
      if (now - lastWriteRef.current >= WRITE_THROTTLE_MS) {
        lastWriteRef.current = now
        writeLastActivity(now)
      }
    }

    // Re-evaluate the moment the tab is looked at again, so waking a slept
    // laptop doesn't leave stale content on screen for a further tick.
    function onVisibility() {
      if (document.visibilityState === 'visible') tick()
    }

    const interval = setInterval(tick, TICK_MS)
    ACTIVITY_EVENTS.forEach(type =>
      document.addEventListener(type, onActivity, { passive: true, capture: true })
    )
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      ACTIVITY_EVENTS.forEach(type =>
        document.removeEventListener(type, onActivity, { capture: true })
      )
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])

  return { msRemaining, stayActive }
}
