import { supabaseAdmin } from '../../lib/supabase'

function getFingerprint(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown'
  const ua = req.headers['user-agent'] ?? ''
  return Buffer.from(`${ip}:${ua}`).toString('base64').slice(0, 32)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { station_id, county } = req.body
  if (!station_id) return res.status(400).json({ error: 'station_id is required' })

  const fingerprint = getFingerprint(req)

  // Check if this contributor already confirmed this station recently
  const { data: recent } = await supabaseAdmin
    .from('reports')
    .select('id')
    .eq('station_id', station_id)
    .eq('fingerprint', fingerprint)
    .eq('report_type', 'confirm_price')
    .gte('created_at', new Date(Date.now() - 3600000).toISOString())
    .limit(1)

  if (recent?.length > 0) {
    return res.status(200).json({ success: true, already_confirmed: true })
  }

  // Get latest price to confirm
  const { data: latestPrice } = await supabaseAdmin
    .from('prices')
    .select('id, petrol_price, diesel_price, confidence')
    .eq('station_id', station_id)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single()

  if (!latestPrice) return res.status(404).json({ error: 'No price data for this station' })

  // Insert confirmation report
  await supabaseAdmin.from('reports').insert({
    station_id,
    petrol_price: latestPrice.petrol_price,
    diesel_price: latestPrice.diesel_price,
    petrol_status: 'available',
    diesel_status: 'available',
    fingerprint,
    report_type: 'confirm_price',
    confidence_delta: 0.5,
    approved: true,
  })

  // Boost confidence
  const newConfidence = Math.min(5.0, (latestPrice.confidence ?? 3.0) + 0.5)
  await supabaseAdmin
    .from('prices')
    .update({ confidence: newConfidence })
    .eq('id', latestPrice.id)

  // Update contributor
  const { data: existing } = await supabaseAdmin
    .from('contributors')
    .select('*')
    .eq('fingerprint', fingerprint)
    .single()

  if (existing) {
    await supabaseAdmin
      .from('contributors')
      .update({
        confirmations: existing.confirmations + 1,
        score: existing.score + 0.5,
        last_active: new Date().toISOString(),
        county: county ?? existing.county,
      })
      .eq('fingerprint', fingerprint)
  } else {
    await supabaseAdmin.from('contributors').insert({
      fingerprint,
      county: county ?? null,
      confirmations: 1,
      score: 0.5,
    })
  }

  return res.status(200).json({
    success: true,
    new_confidence: newConfidence,
    message: 'Thanks for confirming — this helps everyone nearby.',
  })
}