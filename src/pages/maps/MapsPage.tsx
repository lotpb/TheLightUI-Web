import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GoogleMap, useJsApiLoader, DirectionsRenderer, Circle, Marker,
} from '@react-google-maps/api'
import { useSearchParams } from 'react-router-dom'

import ConfirmModal from '../../components/ConfirmModal'
import { Icon, ICONS } from '../../components/Icon'
import { useGeolocation } from '../../hooks/useGeolocation'
import { useGeofenceMonitor } from '../../hooks/useGeofenceMonitor'
import { useIsLightMode } from '../../hooks/useIsLightMode'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  useMapStore, MAX_GEOFENCES,
  type MapFavorite, type MapGeofence, type GeofenceState,
} from '../../stores/mapStore'
import {
  geofenceStyle, formatRadius, RADIUS_CHOICES, DEFAULT_RADIUS,
} from '../../utils/geofenceStyle'
import { googleMapsUrl, type TravelMode } from '../../utils/mapsLink'

const LIBRARIES: ('places' | 'geometry')[] = ['places', 'geometry']

type PanelTab = 'directions' | 'favorites' | 'geofences'

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'directions', label: 'Directions' },
  { key: 'favorites',  label: 'Favorites' },
  { key: 'geofences',  label: 'Geofences' },
]

const MODES: { key: TravelMode; label: string }[] = [
  { key: 'DRIVING', label: 'Drive' },
  { key: 'WALKING', label: 'Walk' },
  { key: 'TRANSIT', label: 'Transit' },
]

const FALLBACK_CENTER = { lat: 26.35, lng: -80.1 }

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MapsPage() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey ?? '',
    libraries: LIBRARIES,
  })

  const { position, error: geoError } = useGeolocation()
  useGeofenceMonitor(position)
  const light = useIsLightMode()

  const [searchParams] = useSearchParams()
  const initialAddress = searchParams.get('address') ?? ''

  usePageTitle('Maps')
  const [mapRef, setMapRef] = useState<google.maps.Map | null>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>('directions')
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null)
  const [routeAddress, setRouteAddress] = useState(initialAddress)
  const [routeInput, setRouteInput] = useState(initialAddress)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeSummary, setRouteSummary] = useState<{ distance: string; duration: string } | null>(null)
  const [travelMode, setTravelMode] = useState<TravelMode>('DRIVING')
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [pendingFence, setPendingFence] = useState<{ lat: number; lng: number } | null>(null)

  const { favorites, geofences, geofenceAlerts, geofenceStates,
    setBuiltInAddress, addCustomFavorite, removeCustomFavorite,
    addGeofence, removeGeofence, clearGeofences, setGeofenceAlerts } = useMapStore()

  /**
   * Whether the map should follow the user.
   *
   * `center` used to be a controlled prop derived from `position`, and
   * useGeolocation runs watchPosition continuously — so every GPS tick called
   * setCenter and threw away whatever you were looking at. Framing a route
   * with fitBounds lasted until the next fix. There was even a guard for this
   * (`if (… && !directions)`) but the prop bypassed it entirely.
   *
   * The map is uncontrolled now: it is centred once on load, follows you only
   * while you haven't touched it and no route is shown, and there's a
   * Recenter button to opt back in.
   */
  const [followMe, setFollowMe] = useState(true)
  const centredOnce = useRef(false)

  const onMapLoad = useCallback((map: google.maps.Map) => {
    setMapRef(map)
    map.setCenter(FALLBACK_CENTER)
    map.setZoom(15)
  }, [])

  // First fix: centre on it once, however long it takes to arrive.
  useEffect(() => {
    if (!mapRef || !position || centredOnce.current) return
    centredOnce.current = true
    if (!directions) mapRef.panTo({ lat: position.lat, lng: position.lng })
  }, [mapRef, position, directions])

  useEffect(() => {
    if (!mapRef || !position || !followMe || directions) return
    mapRef.panTo({ lat: position.lat, lng: position.lng })
  }, [mapRef, position, followMe, directions])

  const recenter = useCallback(() => {
    if (!mapRef || !position) return
    setFollowMe(true)
    mapRef.panTo({ lat: position.lat, lng: position.lng })
    mapRef.setZoom(15)
  }, [mapRef, position])

  /**
   * `styles` is ignored whenever `mapId` is present — the Maps JS API says so
   * outright in the console — and MAP_ID was the literal 'thelight-map',
   * which is not a Cloud Console map ID and matches no cloud style. So the
   * dark palette below had never rendered: the map came up in Google's stock
   * light basemap inside a dark app. No mapId, and the styles follow the
   * theme (light mode wants the stock basemap, which is what `[]` gives).
   */
  const mapOptions = useMemo<google.maps.MapOptions>(() => ({
    disableDefaultUI: false,
    zoomControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
    styles: light ? [] : darkMapStyles,
  }), [light])

  const calculateRoute = useCallback(async (address: string, mode: TravelMode) => {
    if (!position) { setRouteError('Waiting for your location…'); return }
    if (!address.trim()) { setRouteError('Enter a destination address'); return }
    if (!window.google) return

    setRouteLoading(true)
    setRouteError(null)
    setDirections(null)
    setRouteSummary(null)

    const svc = new window.google.maps.DirectionsService()
    svc.route(
      {
        origin: { lat: position.lat, lng: position.lng },
        destination: address,
        travelMode: window.google.maps.TravelMode[mode],
      },
      (result, status) => {
        setRouteLoading(false)
        if (status === 'OK' && result) {
          setDirections(result)
          setRouteAddress(address)
          setFollowMe(false)          // the route is the thing to look at now
          const leg = result.routes[0]?.legs[0]
          if (leg) {
            setRouteSummary({
              distance: leg.distance?.text ?? '',
              duration: leg.duration?.text ?? '',
            })
          }
          setActiveTab('directions')
        } else if (status === 'NOT_FOUND' || status === 'ZERO_RESULTS') {
          setRouteError('Address not found. Check and try again.')
        } else {
          setRouteError(`Directions error: ${status}`)
        }
      },
    )
  }, [position])

  // Auto-route when opened from a customer record
  useEffect(() => {
    if (initialAddress && isLoaded && position) calculateRoute(initialAddress, travelMode)
  }, [initialAddress, isLoaded, position])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapRef && directions?.routes[0]?.bounds) mapRef.fitBounds(directions.routes[0].bounds)
  }, [directions, mapRef])

  function clearRoute() {
    setDirections(null)
    setRouteSummary(null)
    setRouteAddress('')
    setRouteInput('')
    setRouteError(null)
    recenter()
  }

  const atCap = geofences.length >= MAX_GEOFENCES

  if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_GOOGLE_MAPS_API_KEY') return <MapSetupNotice reason="missing" />
  if (loadError) return <MapSetupNotice reason="failed" detail={loadError.message} />
  if (!isLoaded) return <MapsSkeleton />

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      {/* ── Side panel ── */}
      <div className="w-full md:w-80 shrink-0 flex flex-col bg-gray-900 border-r border-gray-800 z-10
                      md:h-full h-[45vh] overflow-hidden">
        <div className="p-3 border-b border-gray-800 space-y-2">
          <div className="flex gap-2">
            <label htmlFor="map-destination" className="sr-only">Destination address</label>
            <input
              id="map-destination"
              type="text"
              className="input-field flex-1 text-sm"
              placeholder="Enter destination address…"
              value={routeInput}
              onChange={e => setRouteInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && calculateRoute(routeInput, travelMode)}
            />
            {/* Was a bare "→" with no accessible name, announced as "right
                arrow", and "…" while loading. */}
            <button
              onClick={() => calculateRoute(routeInput, travelMode)}
              disabled={routeLoading}
              aria-label="Get directions"
              className="btn-primary text-sm px-3 shrink-0 flex items-center justify-center"
            >
              {routeLoading
                ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Icon d={ICONS.arrowRight} className="w-4 h-4" />}
            </button>
          </div>

          <div role="group" aria-label="Travel mode" className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
            {MODES.map(m => (
              <button
                key={m.key}
                type="button"
                aria-pressed={travelMode === m.key}
                onClick={() => {
                  setTravelMode(m.key)
                  if (routeAddress) calculateRoute(routeAddress, m.key)
                }}
                className={`flex-1 py-1.5 font-medium transition-colors
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                  travelMode === m.key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {routeError && <p className="text-red-400 text-xs px-1">{routeError}</p>}
          {/* geoError rendered here *and* as a floating overlay on the map. */}
          {geoError && (
            <p className="text-yellow-300 text-xs px-1 flex items-start gap-1.5">
              <Icon d={ICONS.warning} className="w-3.5 h-3.5 shrink-0 mt-px" />
              {geoError}
            </p>
          )}

          {routeSummary && (
            <div className="flex items-center gap-2 px-1 flex-wrap">
              <span className="text-sm font-semibold text-indigo-400">{routeSummary.duration}</span>
              <span className="text-xs text-gray-400">{routeSummary.distance}</span>
              <a
                href={googleMapsUrl(position, routeAddress, travelMode)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 rounded px-1.5 py-1
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon d={ICONS.externalLink} className="w-3 h-3" />
                Navigate
              </a>
              {/* Was text-gray-500 — 3.67:1 on this panel — for the control
                  that discards the route you just calculated. */}
              <button
                onClick={clearRoute}
                className="text-xs text-gray-300 hover:text-red-400 rounded px-1.5 py-1
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Were plain buttons with no roles, so nothing announced them as tabs
            or said which was selected. */}
        <div role="tablist" aria-label="Map panel" className="flex border-b border-gray-800 text-xs font-medium">
          {TABS.map(tab => (
            <button
              key={tab.key}
              role="tab"
              id={`map-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls={`map-panel-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                activeTab === tab.key
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-gray-400 hover:text-gray-100'
              }`}
            >
              {tab.label}
              {tab.key === 'geofences' && geofences.length > 0 && (
                <span className="ml-1 text-gray-400">({geofences.length})</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'directions' && (
            <div role="tabpanel" id="map-panel-directions" aria-labelledby="map-tab-directions">
              <DirectionsTab result={directions} routeAddress={routeAddress} />
            </div>
          )}
          {activeTab === 'favorites' && (
            <div role="tabpanel" id="map-panel-favorites" aria-labelledby="map-tab-favorites">
              <FavoritesTab
                favorites={favorites}
                onRoute={addr => { setRouteInput(addr); calculateRoute(addr, travelMode) }}
                onSetBuiltIn={setBuiltInAddress}
                onAddCustom={addCustomFavorite}
                onRemoveCustom={removeCustomFavorite}
              />
            </div>
          )}
          {activeTab === 'geofences' && (
            <div role="tabpanel" id="map-panel-geofences" aria-labelledby="map-tab-geofences">
              <GeofencesTab
                geofences={geofences}
                geofenceStates={geofenceStates}
                alertsEnabled={geofenceAlerts}
                light={light}
                atCap={atCap}
                onToggleAlerts={setGeofenceAlerts}
                onRemove={removeGeofence}
                onClear={() => setConfirmClearOpen(true)}
                onFocusFence={fence => { setFollowMe(false); mapRef?.panTo({ lat: fence.lat, lng: fence.lng }) }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 relative">
        <GoogleMap
          mapContainerClassName="w-full h-full"
          onLoad={onMapLoad}
          options={mapOptions}
          onDragStart={() => setFollowMe(false)}
          onClick={e => {
            // Opened a native window.prompt, and cancelling it still created
            // the geofence — prompt() returns null, `?? ''` made it a blank
            // name, and the store filled in a default. There was no way out
            // of a misclick.
            if (activeTab === 'geofences' && e.latLng && !atCap) {
              setPendingFence({ lat: e.latLng.lat(), lng: e.latLng.lng() })
            }
          }}
        >
          {position && (
            <Marker
              position={{ lat: position.lat, lng: position.lng }}
              icon={{
                path: window.google?.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: '#6366f1',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
              }}
              title="Your location"
            />
          )}

          {directions && (
            <DirectionsRenderer
              directions={directions}
              options={{
                suppressMarkers: false,
                polylineOptions: { strokeColor: '#6366f1', strokeWeight: 5 },
              }}
            />
          )}

          {geofences.map(fence => (
            <GeofenceCircle
              key={fence.id}
              fence={fence}
              state={geofenceStates[fence.id] ?? 'unknown'}
              light={light}
            />
          ))}
        </GoogleMap>

        {position && (
          <button
            onClick={recenter}
            aria-label="Recenter on my location"
            aria-pressed={followMe}
            className={`absolute bottom-6 right-3 w-10 h-10 rounded-full shadow-lg backdrop-blur-sm
                        flex items-center justify-center border transition-colors
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              followMe
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-900/85 border-gray-700 text-gray-200 hover:text-white'
            }`}
          >
            <Icon d={ICONS.crosshair} className="w-5 h-5" />
          </button>
        )}

        {activeTab === 'geofences' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/85 border border-gray-700
                          rounded-full px-4 py-2 text-gray-200 text-xs backdrop-blur-sm pointer-events-none">
            {atCap
              ? `Limit reached — ${MAX_GEOFENCES} geofences`
              : 'Tap the map to place a geofence'}
          </div>
        )}
      </div>

      <GeofencePlacementModal
        at={pendingFence}
        onCancel={() => setPendingFence(null)}
        onConfirm={(name, radius) => {
          if (pendingFence) addGeofence(name, pendingFence.lat, pendingFence.lng, radius)
          setPendingFence(null)
        }}
      />

      <ConfirmModal
        isOpen={confirmClearOpen}
        message="Clear all geofences? This cannot be undone."
        confirmLabel="Clear All"
        onConfirm={() => { setConfirmClearOpen(false); clearGeofences() }}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  )
}

// ─── Geofence placement ───────────────────────────────────────────────────────

function GeofencePlacementModal({ at, onCancel, onConfirm }: {
  at: { lat: number; lng: number } | null
  onCancel: () => void
  onConfirm: (name: string, radius: number) => void
}) {
  const [name, setName] = useState('')
  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS)

  // Reset per placement, so the previous name doesn't come back with the next
  // tap on the map.
  useEffect(() => {
    if (at) { setName(''); setRadius(DEFAULT_RADIUS) }
  }, [at])

  if (!at) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="geofence-modal-title"
      onClick={onCancel}
    >
      <div className="card w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h2 id="geofence-modal-title" className="text-base font-semibold text-white">New geofence</h2>
          <p className="text-xs text-gray-400 mt-1 tabular-nums">
            {at.lat.toFixed(5)}, {at.lng.toFixed(5)}
          </p>
        </div>

        <div>
          <label htmlFor="fence-name" className="form-label">Name</label>
          <input
            id="fence-name"
            autoFocus
            className="input-field text-sm"
            placeholder="Leave blank for a default name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onConfirm(name.trim(), radius)
              if (e.key === 'Escape') onCancel()
            }}
          />
        </div>

        <div>
          {/* The radius was hardcoded to 200 m in the map's click handler, and
              the only mention of it was a line of hint text. */}
          <span className="form-label">Radius</span>
          <div role="group" aria-label="Radius" className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
            {RADIUS_CHOICES.map(r => (
              <button
                key={r}
                type="button"
                aria-pressed={radius === r}
                onClick={() => setRadius(r)}
                className={`flex-1 py-1.5 font-medium transition-colors
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                  radius === r ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-700/40'
                }`}
              >
                {formatRadius(r)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={() => onConfirm(name.trim(), radius)} className="btn-primary text-sm flex-1">
            Add geofence
          </button>
          <button onClick={onCancel} className="btn-secondary text-sm flex-1">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function GeofenceCircle({ fence, state, light }: {
  fence: MapGeofence
  state: GeofenceState
  light: boolean
}) {
  const s = geofenceStyle(state, light)
  return (
    <Circle
      center={{ lat: fence.lat, lng: fence.lng }}
      radius={fence.radius}
      options={{
        fillColor: s.mapColor,
        fillOpacity: s.fillOpacity,
        strokeColor: s.mapColor,
        strokeOpacity: 0.85,
        strokeWeight: 2,
      }}
    />
  )
}

// ─── Directions tab ───────────────────────────────────────────────────────────

function DirectionsTab({ result, routeAddress }: {
  result: google.maps.DirectionsResult | null
  routeAddress: string
}) {
  if (!result) {
    return (
      <div className="p-6 text-center space-y-2">
        {/* Was a 🗺 emoji, which paints its own bitmap and can't take a colour. */}
        <Icon d={ICONS.mapPin} className="w-7 h-7 mx-auto text-gray-400" />
        <p className="text-sm text-gray-300">Enter a destination above to get directions.</p>
      </div>
    )
  }

  const steps = result.routes[0]?.legs[0]?.steps ?? []

  return (
    <div className="py-2">
      {routeAddress && (
        <p className="px-4 py-2 text-xs text-gray-300 border-b border-gray-800 truncate" title={routeAddress}>
          To {routeAddress}
        </p>
      )}
      <ol>
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 px-4 py-3 border-b border-gray-800/50">
            <span className="text-xs text-indigo-400 font-bold shrink-0 w-5 pt-0.5 tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              {/* step.instructions comes from google.maps.DirectionsStep (Maps JS SDK),
                  which returns HTML with <b> tags for road names. This is Google-controlled
                  data, not user input, so dangerouslySetInnerHTML is safe here. */}
              <p className="text-sm text-gray-200 leading-snug"
                dangerouslySetInnerHTML={{ __html: step.instructions }} />
              {step.distance && (
                <p className="text-xs text-gray-400 mt-1">{step.distance.text}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─── Favorites tab ────────────────────────────────────────────────────────────

/** 28px — the bare text-xs glyph buttons here were 16px tall. */
const ROW_BTN = `text-xs px-2 py-1.5 rounded transition-colors
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`
const ICON_BTN = `p-1.5 rounded transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`

function FavoritesTab({
  favorites, onRoute, onSetBuiltIn, onAddCustom, onRemoveCustom,
}: {
  favorites: MapFavorite[]
  onRoute: (address: string) => void
  onSetBuiltIn: (type: 'home' | 'work', address: string) => void
  onAddCustom: (title: string, address: string) => void
  onRemoveCustom: (id: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAddress, setEditAddress] = useState('')
  const [addingCustom, setAddingCustom] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newAddress, setNewAddress] = useState('')

  const builtIn = favorites.filter(f => f.builtIn)
  const custom  = favorites.filter(f => !f.builtIn)

  function saveBuiltIn(fav: MapFavorite, address: string) {
    if (!fav.builtIn) return       // was a non-null assertion
    onSetBuiltIn(fav.builtIn, address)
    setEditingId(null)
  }

  return (
    <div className="py-2">
      {builtIn.map(fav => (
        <div key={fav.id}>
          {editingId === fav.id ? (
            <div className="px-4 py-3 space-y-2 border-b border-gray-800/50">
              <label htmlFor={`fav-${fav.id}`} className="form-label">{fav.title} address</label>
              <input
                id={`fav-${fav.id}`}
                className="input-field text-sm"
                placeholder="Street, City, State ZIP"
                value={editAddress}
                onChange={e => setEditAddress(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveBuiltIn(fav, editAddress)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => saveBuiltIn(fav, editAddress)} className="btn-primary text-xs px-3 py-1.5 flex-1">Save</button>
                <button onClick={() => setEditingId(null)} className="btn-secondary text-xs px-3 py-1.5 flex-1">Cancel</button>
                {/* A built-in could be set but never unset. */}
                {fav.address && (
                  <button
                    onClick={() => saveBuiltIn(fav, '')}
                    className={`${ROW_BTN} text-red-400 hover:text-red-300 hover:bg-red-900/20 shrink-0`}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50">
              <Icon
                d={fav.builtIn === 'home' ? ICONS.home : ICONS.briefcase}
                className="w-5 h-5 shrink-0 text-gray-400"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-200">{fav.title}</p>
                {/* Was text-gray-500 at 3.67:1 on this panel. */}
                <p className={`text-xs truncate ${fav.address ? 'text-gray-400' : 'text-gray-400 italic'}`}>
                  {fav.address || 'No address set'}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                {fav.address && (
                  <button onClick={() => onRoute(fav.address)} className={`${ROW_BTN} text-indigo-400 hover:text-indigo-300 hover:bg-gray-800`}>
                    Route
                  </button>
                )}
                <button
                  onClick={() => { setEditingId(fav.id); setEditAddress(fav.address) }}
                  className={`${ROW_BTN} text-gray-300 hover:text-gray-100 hover:bg-gray-800`}
                >
                  {fav.address ? 'Edit' : 'Set'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {custom.map(fav => (
        <div key={fav.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50">
          <Icon d={ICONS.star} className="w-5 h-5 shrink-0 text-gray-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-200 truncate">{fav.title}</p>
            <p className="text-xs text-gray-400 truncate">{fav.address}</p>
          </div>
          <div className="flex gap-1 shrink-0 items-center">
            <button onClick={() => onRoute(fav.address)} className={`${ROW_BTN} text-indigo-400 hover:text-indigo-300 hover:bg-gray-800`}>
              Route
            </button>
            {/* Was a bare ✕ glyph: 16px tall, no label, and the destructive
                action sitting next to a 24px one. */}
            <button
              onClick={() => onRemoveCustom(fav.id)}
              aria-label={`Remove ${fav.title}`}
              className={`${ICON_BTN} text-red-400 hover:text-red-300 hover:bg-red-900/20`}
            >
              <Icon d={ICONS.close} className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}

      {addingCustom ? (
        <div className="px-4 py-3 space-y-2">
          <label htmlFor="fav-new-title" className="form-label">Name</label>
          <input id="fav-new-title" className="input-field text-sm" placeholder="e.g. Gym" value={newTitle}
            onChange={e => setNewTitle(e.target.value)} autoFocus />
          <label htmlFor="fav-new-address" className="form-label">Address</label>
          <input id="fav-new-address" className="input-field text-sm" placeholder="Street, City, State ZIP" value={newAddress}
            onChange={e => setNewAddress(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newAddress.trim()) {
                onAddCustom(newTitle.trim() || 'Place', newAddress.trim())
                setAddingCustom(false); setNewTitle(''); setNewAddress('')
              }
              if (e.key === 'Escape') setAddingCustom(false)
            }}
          />
          {/* The Add button was disabled with nothing saying why. */}
          {!newAddress.trim() && <p className="text-xs text-gray-400">An address is required.</p>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (newAddress.trim()) onAddCustom(newTitle.trim() || 'Place', newAddress.trim())
                setAddingCustom(false); setNewTitle(''); setNewAddress('')
              }}
              disabled={!newAddress.trim()}
              className="btn-primary text-xs px-3 py-1.5 flex-1"
            >
              Add
            </button>
            <button onClick={() => setAddingCustom(false)} className="btn-secondary text-xs px-3 py-1.5 flex-1">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingCustom(true)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm text-indigo-400 hover:bg-gray-800/50 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        >
          {/* Was ＋, a fullwidth plus character. */}
          <Icon d={ICONS.plus} className="w-4 h-4" />
          Add favorite
        </button>
      )}
    </div>
  )
}

// ─── Geofences tab ────────────────────────────────────────────────────────────

function GeofencesTab({
  geofences, geofenceStates, alertsEnabled, light, atCap,
  onToggleAlerts, onRemove, onClear, onFocusFence,
}: {
  geofences: MapGeofence[]
  geofenceStates: Record<string, GeofenceState>
  alertsEnabled: boolean
  light: boolean
  atCap: boolean
  onToggleAlerts: (v: boolean) => void
  onRemove: (id: string) => void
  onClear: () => void
  onFocusFence: (f: MapGeofence) => void
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span id="geofence-alerts-label" className="text-sm text-gray-200">Geofence alerts</span>
        <button
          role="switch"
          aria-checked={alertsEnabled}
          aria-labelledby="geofence-alerts-label"
          onClick={() => onToggleAlerts(!alertsEnabled)}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
                      focus-visible:ring-indigo-500 ${alertsEnabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
        >
          {/* bg-white resolves to --color-white, which is dark navy in light
              mode — a 2.84:1 knob on the indigo track. index.css documents
              this trap and ships .toggle-knob for it. */}
          <span className={`absolute top-1 w-4 h-4 toggle-knob rounded-full shadow transition-transform ${
            alertsEnabled ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      <p className="px-4 py-2 text-xs text-gray-400 border-b border-gray-800">
        {atCap
          ? `You have the maximum of ${MAX_GEOFENCES} geofences. Remove one to add another.`
          : `Tap the map to place a geofence. ${geofences.length} of ${MAX_GEOFENCES} used.`}
      </p>

      {geofences.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-300">No geofences yet.</p>
      ) : (
        geofences.map(fence => {
          const state = geofenceStates[fence.id] ?? 'unknown'
          const s = geofenceStyle(state, light)
          return (
            <div key={fence.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50">
              {/* One definition shared with the map circle, and "no fix yet"
                  is a ring rather than a third shade of grey. */}
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} aria-hidden="true" />
              <button
                onClick={() => onFocusFence(fence)}
                className="min-w-0 flex-1 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <p className="text-sm font-medium text-gray-200 truncate">{fence.name}</p>
                <p className="text-xs text-gray-400">{formatRadius(fence.radius)} · {s.label}</p>
              </button>
              <button
                onClick={() => onRemove(fence.id)}
                aria-label={`Remove ${fence.name}`}
                className={`${ICON_BTN} text-red-400 hover:text-red-300 hover:bg-red-900/20 shrink-0`}
              >
                <Icon d={ICONS.close} className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })
      )}

      {geofences.length > 0 && (
        <button
          onClick={onClear}
          className="w-full px-4 py-3 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        >
          Clear all geofences
        </button>
      )}
    </div>
  )
}

// ─── Setup / loading states ───────────────────────────────────────────────────

/**
 * A key that is present but rejected — wrong restrictions, billing not
 * enabled, an API not turned on — used to fall through to a line of red text,
 * which is where people actually land. Both cases get the checklist now.
 */
function MapSetupNotice({ reason, detail }: { reason: 'missing' | 'failed'; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <Icon d={ICONS.mapPin} className="w-10 h-10 text-gray-400 mb-4" />
      <h2 className="text-xl font-bold text-white mb-2">
        {reason === 'missing' ? 'Google Maps API key required' : 'Google Maps could not load'}
      </h2>
      <div className="text-gray-300 text-sm max-w-sm leading-relaxed space-y-2">
        {reason === 'missing' ? (
          <p>
            Add <code className="text-indigo-400">VITE_GOOGLE_MAPS_API_KEY</code> to{' '}
            <code className="text-indigo-400">.env.local</code> and restart the dev server.
          </p>
        ) : (
          <p>
            The key was sent but Google rejected it. The usual causes are HTTP referrer
            restrictions that don&rsquo;t include this origin, billing not enabled on the
            project, or one of the APIs below being off.
          </p>
        )}
        <p>
          Enable <strong>Maps JavaScript API</strong>, <strong>Directions API</strong> and{' '}
          <strong>Geocoding API</strong> in the Google Cloud Console.
        </p>
        {detail && <p className="text-xs text-gray-400 pt-1 break-words">{detail}</p>}
      </div>
    </div>
  )
}

/** Matches the panel-and-map split so the layout doesn't snap in at once. */
function MapsSkeleton() {
  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden animate-pulse" aria-busy="true" aria-label="Loading map">
      <div className="w-full md:w-80 shrink-0 flex flex-col bg-gray-900 border-r border-gray-800 md:h-full h-[45vh]">
        <div className="p-3 border-b border-gray-800 space-y-2">
          <div className="flex gap-2">
            <div className="h-9 flex-1 bg-gray-800 rounded-lg" />
            <div className="h-9 w-11 bg-gray-800 rounded-lg" />
          </div>
          <div className="h-7 bg-gray-800 rounded-lg" />
        </div>
        <div className="flex border-b border-gray-800">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="flex-1 py-2.5"><div className="h-3 mx-4 bg-gray-800 rounded" /></div>)}
        </div>
        <div className="p-4 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded bg-gray-800 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-24 bg-gray-800 rounded" />
                <div className="h-3 w-40 bg-gray-800/70 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 bg-gray-800/60" />
    </div>
  )
}

// ─── Dark map styles ──────────────────────────────────────────────────────────

const darkMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#64779e' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#334e87' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#023e58' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
  { featureType: 'poi', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#023e58' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#3C7680' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#255763' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b0d5ce' }] },
  { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#023747' }] },
  { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
  { featureType: 'transit', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
  { featureType: 'transit.line', elementType: 'geometry.fill', stylers: [{ color: '#283d6a' }] },
  { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#3a4762' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d70' }] },
]
