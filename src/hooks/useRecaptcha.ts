import { useEffect, useRef, useCallback } from 'react'

const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined

interface GrecaptchaV3 {
  ready(cb: () => void): void
  execute(siteKey: string, opts: { action: string }): Promise<string>
}

declare global {
  interface Window { grecaptcha: GrecaptchaV3 }
}

export function useRecaptcha() {
  const loaded = useRef(false)

  useEffect(() => {
    if (!SITE_KEY || loaded.current) return
    loaded.current = true

    const script = document.createElement('script')
    script.src = `https://www.google.com/recaptcha/api.js?render=${SITE_KEY}`
    script.async = true
    document.head.appendChild(script)

    return () => {
      // Don't remove on unmount — grecaptcha may still be initialising and
      // a second registration attempt would reload it unnecessarily.
    }
  }, [])

  const execute = useCallback((action: string): Promise<string> => {
    if (!SITE_KEY) return Promise.resolve('')
    return new Promise((resolve, reject) => {
      window.grecaptcha.ready(() => {
        window.grecaptcha.execute(SITE_KEY!, { action }).then(resolve).catch(reject)
      })
    })
  }, [])

  return { execute, enabled: Boolean(SITE_KEY) }
}
