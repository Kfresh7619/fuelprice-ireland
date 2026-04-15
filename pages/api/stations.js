import { supabaseAdmin } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { lat, lng, radius = 25000, county } = req.query

  if (lat && lng) {
    const { data, error } = await supabaseAdmin.rpc('stations_near', {
      user_lat: parseFloat(lat),
      user_lng: parseFloat(lng),
      radius_m: parseInt(radius),
    })
    if (error) return res.status(500).json({ error: error.message })
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30')
    return res.status(200).json(data)
  }

  let query = supabaseAdmin
    .from('stations')
    .select(`
      id, name, brand, town, county, lat, lng, address,
      prices ( petrol_price, diesel_price, source, scraped_at ),
      availability ( fuel_type, status, confidence, reported_at )
    `)
    .eq('active', true)
    .order('name')

  if (county) query = query.eq('county', county)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  const stations = data.map(s => {
    const sortedPrices = (s.prices || []).sort(
      (a, b) => new Date(b.scraped_at) - new Date(a.scraped_at)
    )
    const latestPrice = sortedPrices[0] ?? null
    const petrolStatus = (s.availability || [])
      .filter(a => a.fuel_type === 'petrol')
      .sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at))[0] ?? null
    const dieselStatus = (s.availability || [])
      .filter(a => a.fuel_type === 'diesel')
      .sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at))[0] ?? null

    return {
      id: s.id,
      name: s.name,
      brand: s.brand,
      town: s.town,
      county: s.county,
      lat: s.lat,
      lng: s.lng,
      address: s.address,
      latestPrice,
      petrolStatus,
      dieselStatus,
    }
  })

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
  return res.status(200).json(stations)
}