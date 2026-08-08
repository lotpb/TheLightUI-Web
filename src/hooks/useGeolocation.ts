import { useEffect, useRef, useState } from 'react'

export interface GeoPosition {
  lat: number
  lng: number
  accuracy: number
  heading: number | null
  speed: number | null
}

interface Options {
  enabled?: boolean
  highAccuracy?: boolean
}

export function useGeolocation({ enabled = true, highAccuracy = true }: Options = {}) {
  const [position, setPosition] = useState<GeoPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const watchId = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.')
      return
    }

    const options: PositionOptions = {
      enableHighAccuracy: highAccuracy,
      maximumAge: 5000,
      timeout: 15000,
    }

    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        setError(null)
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        })
      },
      err => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError('Location permission denied. Enable it in browser settings.')
            break
          case err.POSITION_UNAVAILABLE:
            setError('Location unavailable.')
            break
          case err.TIMEOUT:
            setError('Location timed out. Retrying…')
            break
        }
      },
      options,
    )

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    }
  }, [enabled, highAccuracy])

  return { position, error }
}
