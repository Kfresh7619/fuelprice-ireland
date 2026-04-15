import { supabaseAdmin } from '../../lib/supabase'

const submissionLog = new Map()
const WINDOW_MS = 15 * 60 * 1000
const MAX_SUBMISSIONS = 5

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress
  const now = Date.now()
  const log = submissionLog.get(ip) ?? []
  const recent = log.filter(t => now - t < WINDOW_MS)

  if (recent.length >= MAX_SUBMISSIONS) {
    return res.status(429).json({ error: 'Too many submissions. Try again in 15 minutes.' })
  }

  submissionLog.set(ip, [...recent, now])

  const { station_id, petrol_price, diesel_price, petrol_status, diesel_status } = req.body

  if (!station_id) return res.status(400).json({ error: 'station_id is required' })

  if (petrol_price && (petrol_price < 0.5 || petrol_price > 4.0)) {
    return res.status(400).json({ error: 'Petrol price out of range' })
  }
  if (diesel_price && (diesel_price < 0.5 || diesel_price > 4.0)) {
    return res.status(400).json({ error: 'Diesel price out of range' })
  }

  const { error } = await supabaseAdmin.from('reports').insert({
    station_id,
    petrol_price: petrol_price ?? null,
    diesel_price: diesel_price ?? null,
    petrol_status: petrol_status ?? 'unknown',
    diesel_status: diesel_status ?? 'unknown',
    submitter_ip: ip,
  })

  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json({ success: true })
}