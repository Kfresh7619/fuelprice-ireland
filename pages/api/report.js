import { supabaseAdmin } from '../../lib/supabase'

const WINDOW_MS = 15 * 60 * 1000
const MAX_SUBMISSIONS = 10
const submissionLog = new Map()

function getFingerprint(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown'
  const ua = req.headers['user-agent'] ?? ''
  return Buffer.from(`${ip}:${ua}`).toString('base64').slice(0, 32)
}

function isPlausiblePrice(price) {
  return price >= 0.5 && price <= 5.0
}

async function getOrCreateContributor(fingerprint, county) {
  const { data: existing } = await supabaseAdmin
    .from('contributors')
    .select('*')
    .eq('fingerprint', fingerprint)
    .single()

  if (existing) {
    const lastActive = new Date(existing.last_active)
    const daysSince = (Date.now() - lastActive) / 86400000
    const newStreak = daysSince < 2 ? existing.streak_days + 1 : 1

    await supabaseAdmin
      .from('contributors')
      .update({
        submissions: existing.submissions + 1,
        score: existing.score + 1,
        streak_days: newStreak,
        last_active: new Date().toISOString(),
        county: county ?? existing.county,
      })
      .eq('fingerprint', fingerprint)

    return { ...existing, submissions: existing.submissions + 1, score: existing.score + 1 }
  }

  const { data: created } = await supabaseAdmin
    .from('contributors')
    .insert({
      fingerprint,
      county: county ?? null,
      submissions: 1,
      score: 1,
      streak_days: 1,
    })
    .select()
    .single()

  return created
}

async function getLocalImpact(station_id) {
  const { data: station } = await supabaseAdmin
    .from('stations')
    .select('county')
    .eq('id', station_id)
    .single()

  if (!station) return null

  const { count } = await supabaseAdmin
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('approved', true)

  return { county: station.county, totalReports: count ?? 0 }
}

async function updateConfidence(station_id, fuel_type, delta) {
  const { data: latest } = await supabaseAdmin
    .from('prices')
    .select('id, confidence')
    .eq('station_id', station_id)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single()

  if (latest) {
    const newConfidence = Math.min(5.0, Math.max(1.0, (latest.confidence ?? 3.0) + delta))
    await supabaseAdmin
      .from('prices')
      .update({ confidence: newConfidence })
      .eq('id', latest.id)
    return newConfidence
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const fingerprint = getFingerprint(req)
  const now = Date.now()
  const log = submissionLog.get(fingerprint) ?? []
  const recent = log.filter(t => now - t < WINDOW_MS)

  if (recent.length >= MAX_SUBMISSIONS) {
    return res.status(429).json({ error: 'Too many submissions. Try again in 15 minutes.' })
  }
  submissionLog.set(fingerprint, [...recent, now])

  const {
    station_id,
    petrol_price,
    diesel_price,
    petrol_status,
    diesel_status,
    report_type = 'price_update',
    county,
  } = req.body

  if (!station_id) return res.status(400).json({ error: 'station_id is required' })

  if (petrol_price && !isPlausiblePrice(petrol_price)) {
    return res.status(400).json({ error: 'Petrol price out of plausible range (€0.50–€5.00)' })
  }
  if (diesel_price && !isPlausiblePrice(diesel_price)) {
    return res.status(400).json({ error: 'Diesel price out of plausible range (€0.50–€5.00)' })
  }

  // Confidence delta depends on report type
  const confidenceDelta = report_type === 'confirm_price' ? 0.5
    : report_type === 'incorrect_price' ? -1.0
    : report_type === 'price_update' ? 0.3
    : 0

  const { error: reportError } = await supabaseAdmin.from('reports').insert({
    station_id,
    petrol_price: petrol_price ?? null,
    diesel_price: diesel_price ?? null,
    petrol_status: petrol_status ?? 'unknown',
    diesel_status: diesel_status ?? 'unknown',
    fingerprint,
    report_type,
    confidence_delta: confidenceDelta,
    approved: false,
  })

  if (reportError) return res.status(500).json({ error: reportError.message })

  // Update price confidence
  await updateConfidence(station_id, 'petrol', confidenceDelta)

  // Update contributor reputation
  const contributor = await getOrCreateContributor(fingerprint, county)

  // Get local impact stats
  const impact = await getLocalImpact(station_id)

  // Refresh county leaderboard async (don't await — non-blocking)
  supabaseAdmin.rpc('refresh_county_leaderboard').catch(() => {})

  return res.status(201).json({
    success: true,
    contributor: {
      score: contributor?.score ?? 1,
      submissions: contributor?.submissions ?? 1,
      streak_days: contributor?.streak_days ?? 1,
    },
    impact: impact ? {
      county: impact.county,
      message: `Your update helps drivers in ${impact.county} find better prices.`,
    } : null,
  })
}