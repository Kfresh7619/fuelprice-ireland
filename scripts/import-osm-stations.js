import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const envFile = readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
  envFile.split('\n')
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const idx = line.indexOf('=')
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
    })
)

const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY
)

const COUNTY_LOOKUP = {
  'County Carlow': 'Carlow', 'County Cavan': 'Cavan', 'County Clare': 'Clare',
  'County Cork': 'Cork', 'County Donegal': 'Donegal', 'County Dublin': 'Dublin',
  'County Galway': 'Galway', 'County Kerry': 'Kerry', 'County Kildare': 'Kildare',
  'County Kilkenny': 'Kilkenny', 'County Laois': 'Laois', 'County Leitrim': 'Leitrim',
  'County Limerick': 'Limerick', 'County Longford': 'Longford', 'County Louth': 'Louth',
  'County Mayo': 'Mayo', 'County Meath': 'Meath', 'County Monaghan': 'Monaghan',
  'County Offaly': 'Offaly', 'County Roscommon': 'Roscommon', 'County Sligo': 'Sligo',
  'County Tipperary': 'Tipperary', 'County Waterford': 'Waterford',
  'County Westmeath': 'Westmeath', 'County Wexford': 'Wexford', 'County Wicklow': 'Wicklow',
  'County Antrim': 'Antrim', 'County Armagh': 'Armagh', 'County Down': 'Down',
  'County Fermanagh': 'Fermanagh', 'County Londonderry': 'Londonderry', 'County Tyrone': 'Tyrone',
}

async function reverseGeocodeCounty(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FuelPriceIreland/1.0 (kelly.ebalu@gmail.com)' }
    })
    const data = await res.json()
    const raw = data?.address?.county
      ?? data?.address?.state_district
      ?? data?.address?.state
      ?? null
    return COUNTY_LOOKUP[raw] ?? raw ?? 'Unknown'
  } catch (e) {
    return 'Unknown'
  }
}

function normaliseBrand(tags) {
  const raw = tags?.brand ?? tags?.operator ?? tags?.name ?? null
  if (!raw) return null
  const map = {
    'circle k': 'Circle K', 'topaz': 'Topaz', 'maxol': 'Maxol',
    'applegreen': 'Applegreen', 'esso': 'Esso', 'texaco': 'Texaco',
    'bp': 'BP', 'shell': 'Shell', 'tesco': 'Tesco', 'tesco extra': 'Tesco',
    'tesco express': 'Tesco', 'lidl': 'Lidl', 'costcutter': 'Costcutter',
    'spar': 'Spar', 'mace': 'Mace', 'centra': 'Centra',
    'supervalu': 'SuperValu', 'amber': 'Amber', 'inver': 'Inver', 'certa': 'Certa',
  }
  return map[raw.toLowerCase()] ?? raw
}

function normaliseName(tags) {
  const brand = normaliseBrand(tags)
  const street = tags['addr:street'] ?? tags['addr:city'] ?? tags['addr:town'] ?? null
  if (brand && street) return `${brand} ${street}`
  if (brand) return brand
  return tags.name ?? 'Fuel Station'
}

async function importStations() {
  // Read the downloaded OSM JSON file
  console.log('Reading osm-stations.json...')
  let data
  try {
    const raw = readFileSync('scripts/osm-stations.json', 'utf8')
    data = JSON.parse(raw)
  } catch (e) {
    console.error('Could not read scripts/osm-stations.json:', e.message)
    console.error('Make sure you downloaded the file from overpass-turbo.eu first.')
    process.exit(1)
  }

  // Overpass Turbo exports either raw OSM JSON ({ elements: [...] })
  // or GeoJSON ({ features: [...] }) — handle both
  let elements = []
  if (data.elements) {
    elements = data.elements
    console.log(`Loaded ${elements.length} elements from raw OSM JSON`)
  } else if (data.features) {
    elements = data.features.map(f => ({
      tags: f.properties ?? {},
      lat: f.geometry?.coordinates?.[1] ?? f.geometry?.coordinates?.[0]?.[1],
      lon: f.geometry?.coordinates?.[0] ?? f.geometry?.coordinates?.[0]?.[0],
      center: f.geometry?.type === 'Point' ? {
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      } : null,
    }))
    console.log(`Loaded ${elements.length} elements from GeoJSON`)
  } else {
    console.error('Unrecognised file format. Export as Raw OSM data (JSON) from Overpass Turbo.')
    process.exit(1)
  }

  if (elements.length === 0) {
    console.error('No stations found in file.')
    process.exit(1)
  }

  let imported = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon ?? el.lon

    if (!lat || !lng) {
      skipped++
      continue
    }

    const tags = el.tags ?? {}
    const name = normaliseName(tags)
    const brand = normaliseBrand(tags)
    const address = [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:city'] ?? tags['addr:town'] ?? tags['addr:village'],
    ].filter(Boolean).join(', ') || null

    const town = tags['addr:city']
      ?? tags['addr:town']
      ?? tags['addr:village']
      ?? null

    let county = 'Unknown'
    try {
      county = await reverseGeocodeCounty(lat, lng)
      await new Promise(r => setTimeout(r, 1100))
    } catch (e) {
      console.warn(`Geocode failed for ${name}`)
    }

    const { error } = await supabase
      .from('stations')
      .upsert({
        name,
        brand,
        town: town ?? county,
        county,
        lat,
        lng,
        address,
        active: true,
      }, {
        onConflict: 'name,lat,lng',
        ignoreDuplicates: true,
      })

    if (error) {
      console.error(`Error inserting ${name}:`, error.message)
      errors++
    } else {
      imported++
    }

    if ((i + 1) % 50 === 0) {
      console.log(`Progress: ${i + 1}/${elements.length} — imported: ${imported}, skipped: ${skipped}, errors: ${errors}`)
    }
  }

  console.log('\n--- Import complete ---')
  console.log(`Total stations in file: ${elements.length}`)
  console.log(`Imported:               ${imported}`)
  console.log(`Skipped (no coords):    ${skipped}`)
  console.log(`Errors:                 ${errors}`)
}

importStations().catch(console.error)