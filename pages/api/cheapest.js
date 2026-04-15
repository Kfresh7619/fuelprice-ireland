import { supabaseAdmin } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { county } = req.query

  let query = supabaseAdmin.from('cheapest_by_county').select('*')
  if (county) query = query.eq('county', county)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  const cheapestPetrol = data
    .filter(s => s.petrol_status === 'available' && s.petrol_price)
    .sort((a, b) => a.petrol_price - b.petrol_price)[0] ?? null

  const cheapestDiesel = data
    .filter(s => s.diesel_status === 'available' && s.diesel_price)
    .sort((a, b) => a.diesel_price - b.diesel_price)[0] ?? null

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=30')
  return res.status(200).json({ cheapestPetrol, cheapestDiesel })
}