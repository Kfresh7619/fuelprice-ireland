import { useEffect, useRef, useState, useCallback } from 'react'
import Head from 'next/head'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

const STATUS_COLOR = {
  available: '#16a34a',
  unavailable: '#dc2626',
  unknown: '#d97706',
}

function timeAgo(dateStr) {
  if (!dateStr) return 'unknown'
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function freshnessState(dateStr) {
  if (!dateStr) return 'stale'
  const hours = (Date.now() - new Date(dateStr)) / 3600000
  if (hours < 6) return 'fresh'
  if (hours < 48) return 'aging'
  return 'stale'
}

function AvailabilityDot({ status, size = 8 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      borderRadius: '50%', background: STATUS_COLOR[status ?? 'unknown'], flexShrink: 0,
    }} />
  )
}

function FreshnessTag({ dateStr }) {
  const state = freshnessState(dateStr)
  const colors = {
    fresh: { bg: '#f0fdf4', text: '#15803d' },
    aging: { bg: '#fffbeb', text: '#b45309' },
    stale: { bg: '#fef2f2', text: '#b91c1c' },
  }
  const c = colors[state]
  return (
    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: c.bg, color: c.text, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
      {state === 'stale' ? 'may be outdated' : timeAgo(dateStr)}
    </span>
  )
}

function ConfidenceDots({ confidence = 3 }) {
  const score = Math.round(confidence)
  return (
    <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: i <= score
            ? score >= 4 ? '#16a34a' : score >= 2 ? '#d97706' : '#dc2626'
            : '#e5e7eb',
        }} />
      ))}
    </span>
  )
}

function distKm(pos, s) {
  const R = 6371
  const dLat = (s.lat - pos.lat) * Math.PI / 180
  const dLng = (s.lng - pos.lng) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(pos.lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function Home() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const markersRef = useRef({})

  const [stations, setStations] = useState([])
  const [cheapest, setCheapest] = useState({ cheapestPetrol: null, cheapestDiesel: null })
  const [selected, setSelected] = useState(null)
  const [fuelFilter, setFuelFilter] = useState('all')
  const [availOnly, setAvailOnly] = useState(false)
  const [sortBy, setSortBy] = useState('price')
  const [search, setSearch] = useState('')
  const [userPos, setUserPos] = useState(null)
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchGeoResult, setSearchGeoResult] = useState(null)

  const [reportModal, setReportModal] = useState(null)
  const [reportType, setReportType] = useState('price_update')
  const [reportForm, setReportForm] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)

  const [geofencePrompt, setGeofencePrompt] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [confirmResult, setConfirmResult] = useState(null)
  const [contributorBadge, setContributorBadge] = useState(null)

  useEffect(() => {
    fetch('/api/stations').then(r => r.json()).then(setStations)
    fetch('/api/cheapest').then(r => r.json()).then(setCheapest)
  }, [])

  useEffect(() => {
    if (!userPos || !stations.length) return
    const nearby = stations.filter(s => distKm(userPos, s) < 0.3)
    if (nearby.length > 0 && !geofencePrompt) setGeofencePrompt(nearby[0])
  }, [userPos, stations])

  useEffect(() => {
    if (map.current || !mapContainer.current) return
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-8.0, 53.4],
      zoom: 6.5,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
  }, [])

  useEffect(() => {
    if (!map.current || !stations.length) return
    Object.values(markersRef.current).forEach(m => m.remove())
    markersRef.current = {}
    stations.forEach(s => {
      const petrolColor = STATUS_COLOR[s.petrolStatus?.status ?? 'unknown']
      const dieselColor = STATUS_COLOR[s.dieselStatus?.status ?? 'unknown']
      const stale = freshnessState(s.latestPrice?.scraped_at) === 'stale'
      const el = document.createElement('div')
      el.style.cssText = 'position:relative;width:28px;height:28px;cursor:pointer'
      el.innerHTML = `
        <div style="width:28px;height:28px;border-radius:50%;background:${petrolColor};border:2px solid white;opacity:${stale ? 0.5 : 1};display:flex;align-items:center;justify-content:center">
          <div style="width:8px;height:8px;border-radius:50%;background:white;opacity:0.9"></div>
        </div>
        <div style="position:absolute;bottom:-2px;right:-2px;width:11px;height:11px;border-radius:50%;background:${dieselColor};border:1.5px solid white"></div>
      `
      el.addEventListener('click', () => {
        setSelected(s)
        setMobileListOpen(false)
        map.current.flyTo({ center: [s.lng, s.lat], zoom: 14 })
      })
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([s.lng, s.lat])
        .addTo(map.current)
      markersRef.current[s.id] = marker
    })
  }, [stations])

  const getFiltered = useCallback(() => {
    let list = [...stations]
    // If search has a geocoded result but no local station matches, show all
    if (search && !searchGeoResult) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.town.toLowerCase().includes(q) ||
        s.county.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q) ||
        s.brand?.toLowerCase().includes(q)
      )
    }
    if (availOnly) {
      list = list.filter(s => {
        if (fuelFilter === 'petrol') return s.petrolStatus?.status === 'available'
        if (fuelFilter === 'diesel') return s.dieselStatus?.status === 'available'
        return s.petrolStatus?.status === 'available' || s.dieselStatus?.status === 'available'
      })
    }
    if (sortBy === 'price') {
      list.sort((a, b) => {
        const ap = fuelFilter === 'diesel' ? a.latestPrice?.diesel_price : a.latestPrice?.petrol_price
        const bp = fuelFilter === 'diesel' ? b.latestPrice?.diesel_price : b.latestPrice?.petrol_price
        return (ap ?? 99) - (bp ?? 99)
      })
    } else if (sortBy === 'distance' && userPos) {
      list.sort((a, b) => distKm(userPos, a) - distKm(userPos, b))
    } else if (sortBy === 'updated') {
      list.sort((a, b) => new Date(b.latestPrice?.scraped_at ?? 0) - new Date(a.latestPrice?.scraped_at ?? 0))
    }
    return list
  }, [stations, search, searchGeoResult, availOnly, fuelFilter, sortBy, userPos])

  // Geocode search via Mapbox and load nearby stations
  const geocodeSearch = useCallback(async (query) => {
    if (!query || query.length < 2) return
    setSearching(true)
    setSearchGeoResult(null)
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=ie&types=place,locality,neighborhood,address,poi&access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&limit=1`
      const res = await fetch(url)
      const data = await res.json()
      const feature = data.features?.[0]
      if (feature) {
        const [lng, lat] = feature.center
        setSearchGeoResult({ lat, lng, name: feature.place_name })
        map.current?.flyTo({ center: [lng, lat], zoom: 11 })
        // Load stations near this location
        const stationsRes = await fetch(`/api/stations?lat=${lat}&lng=${lng}&radius=30000`)
        const nearbyStations = await stationsRes.json()
        if (Array.isArray(nearbyStations) && nearbyStations.length > 0) {
          setStations(nearbyStations)
          setSortBy('distance')
          setUserPos({ lat, lng })
        }
      }
    } catch (e) {
      console.error('Geocode error:', e)
    }
    setSearching(false)
  }, [])

  // Debounce search — run geocoding after user stops typing for 600ms
  const searchDebounceRef = useRef(null)
  const handleSearchChange = useCallback((value) => {
    setSearch(value)
    setSearchGeoResult(null)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (value.length >= 2) {
      searchDebounceRef.current = setTimeout(() => geocodeSearch(value), 600)
    }
  }, [geocodeSearch])

  const clearSearch = useCallback(() => {
    setSearch('')
    setSearchGeoResult(null)
    setUserPos(null)
    fetch('/api/stations').then(r => r.json()).then(setStations)
    map.current?.flyTo({ center: [-8.0, 53.4], zoom: 6.5 })
  }, [])

  // iOS-safe geolocation — must be called synchronously in click handler
  const locateMe = useCallback(() => {
    setLocateError(null)
    if (!navigator.geolocation) {
      setLocateError('Geolocation is not supported by your browser.')
      return
    }
    setLocating(true)
    // Options tuned for mobile: high accuracy, 15s timeout, no cache
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        setUserPos({ lat, lng })
        setSortBy('distance')
        setLocating(false)
        setLocateError(null)
        map.current?.flyTo({ center: [lng, lat], zoom: 12 })
        fetch(`/api/stations?lat=${lat}&lng=${lng}&radius=25000`)
          .then(r => r.json())
          .then(data => {
            if (Array.isArray(data) && data.length > 0) {
              setStations(data)
            }
          })
      },
      (err) => {
        setLocating(false)
        switch (err.code) {
          case 1:
            setLocateError('Location access denied. Please enable location permissions in your browser settings.')
            break
          case 2:
            setLocateError('Could not determine your location. Please try again.')
            break
          case 3:
            setLocateError('Location request timed out. Please try again.')
            break
          default:
            setLocateError('Location unavailable. Please try again.')
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [])

  const handleConfirm = async (station) => {
    setConfirming(station.id)
    const res = await fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_id: station.id, county: station.county }),
    })
    const data = await res.json()
    setConfirming(null)
    setGeofencePrompt(null)
    setConfirmResult({
      message: data.already_confirmed ? 'Already confirmed recently — thanks!' : data.message ?? 'Confirmed!',
      county: station.county,
    })
    setTimeout(() => setConfirmResult(null), 4000)
  }

  const submitReport = async () => {
    if (!reportModal) return
    setSubmitting(true)
    const body = {
      station_id: reportModal.id,
      petrol_price: reportForm.petrol_price ? parseFloat(reportForm.petrol_price) : undefined,
      diesel_price: reportForm.diesel_price ? parseFloat(reportForm.diesel_price) : undefined,
      petrol_status: reportForm.petrol_status ?? reportModal.petrolStatus?.status ?? 'unknown',
      diesel_status: reportForm.diesel_status ?? reportModal.dieselStatus?.status ?? 'unknown',
      report_type: reportType,
      county: reportModal.county,
    }
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setSubmitResult(data)
      if (data.contributor) setContributorBadge(data.contributor)
      setTimeout(() => { setReportModal(null); setSubmitResult(null) }, 3000)
    } else {
      setSubmitResult({ error: data.error ?? 'Something went wrong' })
    }
  }

  const filtered = getFiltered()

  const StationCard = ({ s }) => {
    const isCheapestPetrol = cheapest.cheapestPetrol?.station_id === s.id
    const isCheapestDiesel = cheapest.cheapestDiesel?.station_id === s.id
    const isSelected = selected?.id === s.id
    const dStr = userPos ? `${distKm(userPos, s).toFixed(1)} km` : ''

    return (
      <div
        onClick={() => {
          setSelected(s)
          setMobileListOpen(false)
          map.current?.flyTo({ center: [s.lng, s.lat], zoom: 14 })
        }}
        style={{
          padding: '10px 12px', borderRadius: 9, marginBottom: 5, cursor: 'pointer',
          border: `1px solid ${isSelected ? '#1d4ed8' : '#e5e7eb'}`,
          borderLeft: isCheapestPetrol ? '3px solid #16a34a' : isCheapestDiesel ? '3px solid #d97706' : undefined,
          background: isSelected ? '#eff6ff' : '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AvailabilityDot status={s.petrolStatus?.status} size={7} />
              {s.name}
              <span style={{ fontWeight: 400, color: '#6b7280' }}>· {s.town}</span>
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{s.county}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0, marginLeft: 8 }}>
            {isCheapestPetrol && <span style={{ fontSize: 10, background: '#eff6ff', color: '#1d4ed8', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>Cheapest petrol</span>}
            {isCheapestDiesel && <span style={{ fontSize: 10, background: '#fffbeb', color: '#b45309', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>Cheapest diesel</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {fuelFilter !== 'diesel' && (
            <div style={{ padding: '5px 9px', borderRadius: 6, border: `1px solid ${isCheapestPetrol ? '#16a34a' : '#e5e7eb'}`, background: isCheapestPetrol ? '#f0fdf4' : '#f9fafb', minWidth: 64, textAlign: 'center' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '0.4px' }}>Petrol</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: isCheapestPetrol ? '#16a34a' : '#111' }}>€{Number(s.latestPrice?.petrol_price ?? 0).toFixed(3)}</div>
              <div style={{ fontSize: 9, color: STATUS_COLOR[s.petrolStatus?.status ?? 'unknown'], display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                <AvailabilityDot status={s.petrolStatus?.status} size={5} />
                {s.petrolStatus?.status ?? 'unknown'}
              </div>
            </div>
          )}
          {fuelFilter !== 'petrol' && (
            <div style={{ padding: '5px 9px', borderRadius: 6, border: `1px solid ${isCheapestDiesel ? '#d97706' : '#e5e7eb'}`, background: isCheapestDiesel ? '#fffbeb' : '#f9fafb', minWidth: 64, textAlign: 'center' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '0.4px' }}>Diesel</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: isCheapestDiesel ? '#d97706' : '#111' }}>€{Number(s.latestPrice?.diesel_price ?? 0).toFixed(3)}</div>
              <div style={{ fontSize: 9, color: STATUS_COLOR[s.dieselStatus?.status ?? 'unknown'], display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                <AvailabilityDot status={s.dieselStatus?.status} size={5} />
                {s.dieselStatus?.status ?? 'unknown'}
              </div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            {dStr && <div style={{ fontSize: 11, color: '#9ca3af' }}>{dStr}</div>}
            <FreshnessTag dateStr={s.latestPrice?.scraped_at} />
            <ConfidenceDots confidence={s.latestPrice?.confidence ?? 3} />
          </div>
        </div>
      </div>
    )
  }

  const SearchBar = ({ mobile = false }) => (
    <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && geocodeSearch(search)}
          placeholder="Search town, county, station..."
          style={{ width: '100%', padding: '8px 32px 8px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        />
        {search && (
          <button onClick={clearSearch} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
        )}
      </div>
      <button
        onClick={locateMe}
        disabled={locating}
        style={{ padding: '8px 12px', background: locating ? '#93c5fd' : '#1d4ed8', color: 'white', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: locating ? 'wait' : 'pointer', whiteSpace: 'nowrap', minWidth: 80 }}
      >
        {locating ? 'Finding...' : 'Near me'}
      </button>
    </div>
  )

  return (
    <>
      <Head>
        <title>FuelPrice Ireland</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          body { margin: 0; }
          @media (max-width: 768px) {
            .desktop-sidebar { display: none !important; }
            .mobile-bar { display: flex !important; }
          }
          @media (min-width: 769px) {
            .mobile-bar { display: none !important; }
          }
        `}</style>
      </Head>

      <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif', fontSize: 14, position: 'relative' }}>

        {/* DESKTOP SIDEBAR */}
        <div className="desktop-sidebar" style={{ width: 340, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', background: '#fff', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 28, height: 28, background: '#1d4ed8', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.2px' }}>FuelPrice Ireland</div>
                <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>Live prices + availability</div>
              </div>
              {contributorBadge && (
                <div style={{ marginLeft: 'auto', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '4px 8px', fontSize: 11, color: '#1d4ed8', textAlign: 'center' }}>
                  <div style={{ fontWeight: 600 }}>Score {contributorBadge.score}</div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>{contributorBadge.submissions} updates</div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, background: '#f9fafb', borderRadius: 8, padding: '8px 10px', marginBottom: 10, border: '1px solid #e5e7eb' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Cheapest petrol</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#16a34a' }}>{cheapest.cheapestPetrol ? `€${Number(cheapest.cheapestPetrol.petrol_price).toFixed(3)}` : '—'}</div>
                <div style={{ fontSize: 10, color: '#9ca3af' }}>{cheapest.cheapestPetrol?.town ?? '—'}</div>
              </div>
              <div style={{ width: 1, background: '#e5e7eb' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Cheapest diesel</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#d97706' }}>{cheapest.cheapestDiesel ? `€${Number(cheapest.cheapestDiesel.diesel_price).toFixed(3)}` : '—'}</div>
                <div style={{ fontSize: 10, color: '#9ca3af' }}>{cheapest.cheapestDiesel?.town ?? '—'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
              {['all', 'petrol', 'diesel'].map(f => (
                <button key={f} onClick={() => setFuelFilter(f)} style={{ padding: '3px 10px', borderRadius: 20, border: '1px solid', fontSize: 12, cursor: 'pointer', background: fuelFilter === f ? '#1d4ed8' : '#f9fafb', color: fuelFilter === f ? 'white' : '#6b7280', borderColor: fuelFilter === f ? '#1d4ed8' : '#e5e7eb' }}>
                  {f === 'all' ? 'All fuel' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <button onClick={() => setAvailOnly(v => !v)} style={{ padding: '3px 10px', borderRadius: 20, border: '1px solid', fontSize: 12, cursor: 'pointer', background: availOnly ? '#16a34a' : '#f9fafb', color: availOnly ? 'white' : '#6b7280', borderColor: availOnly ? '#16a34a' : '#e5e7eb' }}>
                Available only
              </button>
            </div>

            <SearchBar />

            {locateError && (
              <div style={{ marginTop: 6, padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11, color: '#b91c1c' }}>
                {locateError}
              </div>
            )}

            {searching && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280', textAlign: 'center' }}>Searching...</div>
            )}

            {searchGeoResult && (
              <div style={{ marginTop: 6, padding: '5px 10px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: 11, color: '#15803d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Showing stations near {search}</span>
                <button onClick={clearSearch} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13 }}>×</button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
            <span style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Sort:</span>
            {['price', 'distance', 'updated'].map(s => (
              <button key={s} onClick={() => setSortBy(s)} style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid', fontSize: 12, cursor: 'pointer', background: sortBy === s ? '#1d4ed8' : '#fff', color: sortBy === s ? 'white' : '#6b7280', borderColor: sortBy === s ? '#1d4ed8' : '#e5e7eb' }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
            {filtered.length === 0 && !searching && (
              <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>
                <div style={{ fontSize: 13, marginBottom: 4 }}>No stations found near "{search}"</div>
                <div style={{ fontSize: 11 }}>Try a different town or county</div>
              </div>
            )}
            {filtered.map(s => <StationCard key={s.id} s={s} />)}
          </div>
        </div>

        {/* MAP */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

          <div className="desktop-sidebar" style={{ display: 'flex', position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 14px', gap: 14, zIndex: 500, whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#6b7280', letterSpacing: '0.5px' }}>Cheapest petrol</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#16a34a' }}>{cheapest.cheapestPetrol ? `€${Number(cheapest.cheapestPetrol.petrol_price).toFixed(3)}` : '—'}</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>{cheapest.cheapestPetrol?.town ?? '—'}</div>
            </div>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#6b7280', letterSpacing: '0.5px' }}>Cheapest diesel</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#d97706' }}>{cheapest.cheapestDiesel ? `€${Number(cheapest.cheapestDiesel.diesel_price).toFixed(3)}` : '—'}</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>{cheapest.cheapestDiesel?.town ?? '—'}</div>
            </div>
          </div>

          {geofencePrompt && (
            <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#fff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 16px', zIndex: 600, minWidth: 280, textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>You're near {geofencePrompt.name}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Are today's prices still correct?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleConfirm(geofencePrompt)} disabled={confirming === geofencePrompt.id}
                  style={{ flex: 1, padding: '8px 0', background: '#16a34a', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                  {confirming === geofencePrompt.id ? 'Confirming...' : 'Yes, looks right'}
                </button>
                <button onClick={() => { setReportModal(geofencePrompt); setReportType('price_update'); setGeofencePrompt(null) }}
                  style={{ flex: 1, padding: '8px 0', background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>
                  Update price
                </button>
                <button onClick={() => setGeofencePrompt(null)}
                  style={{ padding: '8px 10px', background: 'transparent', color: '#9ca3af', border: 'none', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
            </div>
          )}

          {confirmResult && (
            <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '10px 16px', zIndex: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#15803d' }}>{confirmResult.message}</div>
              {confirmResult.county && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Helping drivers in {confirmResult.county}</div>}
            </div>
          )}

          {selected && (
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 300, background: '#fff', borderTop: '1px solid #e5e7eb', borderLeft: '1px solid #e5e7eb', borderRadius: '10px 0 0 0', padding: 16, zIndex: 10 }}>
              <button onClick={() => setSelected(null)} style={{ position: 'absolute', top: 10, right: 10, background: '#f3f4f6', border: 'none', borderRadius: 5, width: 22, height: 22, cursor: 'pointer', fontSize: 14, color: '#6b7280' }}>×</button>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{selected.name}</div>
              <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace', marginBottom: 4 }}>{selected.brand} · {selected.county}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <FreshnessTag dateStr={selected.latestPrice?.scraped_at} />
                <ConfidenceDots confidence={selected.latestPrice?.confidence ?? 3} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ padding: 10, borderRadius: 7, border: '1px solid #e5e7eb', background: '#f9fafb', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '0.4px', marginBottom: 3 }}>Petrol</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: STATUS_COLOR[selected.petrolStatus?.status ?? 'unknown'] }}>€{Number(selected.latestPrice?.petrol_price ?? 0).toFixed(3)}</div>
                  <div style={{ fontSize: 10, color: STATUS_COLOR[selected.petrolStatus?.status ?? 'unknown'], display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <AvailabilityDot status={selected.petrolStatus?.status} size={6} />
                    {selected.petrolStatus?.status ?? 'unknown'}
                  </div>
                </div>
                <div style={{ padding: 10, borderRadius: 7, border: '1px solid #e5e7eb', background: '#f9fafb', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '0.4px', marginBottom: 3 }}>Diesel</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: STATUS_COLOR[selected.dieselStatus?.status ?? 'unknown'] }}>€{Number(selected.latestPrice?.diesel_price ?? 0).toFixed(3)}</div>
                  <div style={{ fontSize: 10, color: STATUS_COLOR[selected.dieselStatus?.status ?? 'unknown'], display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <AvailabilityDot status={selected.dieselStatus?.status} size={6} />
                    {selected.dieselStatus?.status ?? 'unknown'}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, borderTop: '1px solid #f3f4f6', paddingTop: 8, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: '#9ca3af' }}>Address</span><span>{selected.address}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: '#9ca3af' }}>County</span><span>{selected.county}</span></div>
                {userPos && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: '#9ca3af' }}>Distance</span><span>{distKm(userPos, selected).toFixed(1)} km</span></div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: '#9ca3af' }}>Source</span><span>{selected.latestPrice?.source}</span></div>
              </div>
              <button onClick={() => handleConfirm(selected)} disabled={confirming === selected.id}
                style={{ width: '100%', padding: 9, background: '#16a34a', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 6 }}>
                {confirming === selected.id ? 'Confirming...' : 'Confirm prices are correct'}
              </button>
              <button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`, '_blank')}
                style={{ width: '100%', padding: 9, background: '#1d4ed8', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 6 }}>
                Navigate →
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setReportModal(selected); setReportType('price_update'); setReportForm({}) }}
                  style={{ flex: 1, padding: 7, background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>
                  Update price
                </button>
                <button onClick={() => { setReportModal(selected); setReportType('incorrect_price'); setReportForm({}) }}
                  style={{ flex: 1, padding: 7, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>
                  Report error
                </button>
              </div>
            </div>
          )}
        </div>

        {/* MOBILE STICKY BOTTOM BAR */}
        <div className="mobile-bar" style={{ display: 'none', position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', flexDirection: 'column', zIndex: 600 }}>
          <div onClick={() => setMobileListOpen(v => !v)} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <div>
                <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#6b7280', letterSpacing: '0.4px' }}>Cheapest petrol</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: '#16a34a' }}>{cheapest.cheapestPetrol ? `€${Number(cheapest.cheapestPetrol.petrol_price).toFixed(3)}` : '—'}</div>
                <div style={{ fontSize: 10, color: '#9ca3af' }}>{cheapest.cheapestPetrol?.town ?? '—'}</div>
              </div>
              <div style={{ width: 1, background: '#e5e7eb' }} />
              <div>
                <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#6b7280', letterSpacing: '0.4px' }}>Cheapest diesel</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: '#d97706' }}>{cheapest.cheapestDiesel ? `€${Number(cheapest.cheapestDiesel.diesel_price).toFixed(3)}` : '—'}</div>
                <div style={{ fontSize: 10, color: '#9ca3af' }}>{cheapest.cheapestDiesel?.town ?? '—'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <button
                onClick={e => { e.stopPropagation(); locateMe() }}
                disabled={locating}
                style={{ padding: '8px 14px', background: locating ? '#93c5fd' : '#1d4ed8', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: locating ? 'wait' : 'pointer', minWidth: 90 }}
              >
                {locating ? 'Finding...' : 'Near me'}
              </button>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>{mobileListOpen ? '▼ Hide' : '▲ Stations'}</div>
            </div>
          </div>

          {locateError && (
            <div style={{ margin: '0 12px 8px', padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11, color: '#b91c1c' }}>
              {locateError}
            </div>
          )}

          {mobileListOpen && (
            <div style={{ maxHeight: '55vh', overflowY: 'auto', padding: '0 8px 8px', borderTop: '1px solid #f3f4f6' }}>
              <div style={{ padding: '8px 4px' }}>
                <SearchBar mobile />
                {searching && <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', marginTop: 4 }}>Searching...</div>}
                {searchGeoResult && (
                  <div style={{ marginTop: 6, padding: '5px 10px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: 11, color: '#15803d', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Stations near {search}</span>
                    <button onClick={clearSearch} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>×</button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 5, padding: '4px', flexWrap: 'wrap' }}>
                {['all', 'petrol', 'diesel'].map(f => (
                  <button key={f} onClick={() => setFuelFilter(f)} style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid', fontSize: 12, cursor: 'pointer', background: fuelFilter === f ? '#1d4ed8' : '#f9fafb', color: fuelFilter === f ? 'white' : '#6b7280', borderColor: fuelFilter === f ? '#1d4ed8' : '#e5e7eb' }}>
                    {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
                <button onClick={() => setAvailOnly(v => !v)} style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid', fontSize: 12, cursor: 'pointer', background: availOnly ? '#16a34a' : '#f9fafb', color: availOnly ? 'white' : '#6b7280', borderColor: availOnly ? '#16a34a' : '#e5e7eb' }}>
                  Available
                </button>
              </div>
              {filtered.length === 0 && !searching && (
                <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>
                  <div style={{ fontSize: 13 }}>No stations found near "{search}"</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Try a different town or county name</div>
                </div>
              )}
              {filtered.map(s => <StationCard key={s.id} s={s} />)}
            </div>
          )}
        </div>
      </div>

      {/* Report modal */}
      {reportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', width: 310, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
              {reportType === 'incorrect_price' ? 'Report incorrect price' : 'Update prices'}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>{reportModal.name} · {reportModal.county}</div>
            {submitResult ? (
              <div>
                {submitResult.error ? (
                  <div style={{ color: '#dc2626', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>{submitResult.error}</div>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#16a34a', marginBottom: 6 }}>Submitted — thanks!</div>
                    {submitResult.impact && (
                      <div style={{ fontSize: 12, color: '#374151', background: '#f0fdf4', borderRadius: 7, padding: '8px 10px', marginBottom: 8 }}>
                        {submitResult.impact.message}
                      </div>
                    )}
                    {submitResult.contributor && (
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        Your score: {submitResult.contributor.score} · {submitResult.contributor.submissions} updates
                        {submitResult.contributor.streak_days > 1 && ` · ${submitResult.contributor.streak_days} day streak`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {['price_update', 'incorrect_price'].map(t => (
                    <button key={t} onClick={() => setReportType(t)} style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid', fontSize: 12, cursor: 'pointer', background: reportType === t ? (t === 'incorrect_price' ? '#fef2f2' : '#eff6ff') : '#f9fafb', color: reportType === t ? (t === 'incorrect_price' ? '#b91c1c' : '#1d4ed8') : '#6b7280', borderColor: reportType === t ? (t === 'incorrect_price' ? '#fecaca' : '#bfdbfe') : '#e5e7eb' }}>
                      {t === 'price_update' ? 'Update price' : 'Report error'}
                    </button>
                  ))}
                </div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 3 }}>Petrol price (€/L)</label>
                <input type="number" step="0.001" placeholder={`Current: €${Number(reportModal.latestPrice?.petrol_price ?? 0).toFixed(3)}`}
                  onChange={e => setReportForm(f => ({ ...f, petrol_price: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 3 }}>Diesel price (€/L)</label>
                <input type="number" step="0.001" placeholder={`Current: €${Number(reportModal.latestPrice?.diesel_price ?? 0).toFixed(3)}`}
                  onChange={e => setReportForm(f => ({ ...f, diesel_price: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 3 }}>Petrol availability</label>
                <select onChange={e => setReportForm(f => ({ ...f, petrol_status: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, marginBottom: 8 }}>
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="unknown">Unknown</option>
                </select>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 3 }}>Diesel availability</label>
                <select onChange={e => setReportForm(f => ({ ...f, diesel_status: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, marginBottom: 12 }}>
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="unknown">Unknown</option>
                </select>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setReportModal(null); setSubmitResult(null) }}
                    style={{ flex: 1, padding: 8, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, cursor: 'pointer', color: '#6b7280' }}>
                    Cancel
                  </button>
                  <button onClick={submitReport} disabled={submitting}
                    style={{ flex: 1, padding: 8, background: reportType === 'incorrect_price' ? '#dc2626' : '#16a34a', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', color: 'white' }}>
                    {submitting ? 'Submitting...' : 'Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}