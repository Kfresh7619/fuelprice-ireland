import { supabaseAdmin } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { data, error } = await supabaseAdmin
    .from('county_leaderboard')
    .select('*')
    .order('total_submissions', { ascending: false })
    .limit(26)

  if (error) return res.status(500).json({ error: error.message })

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
  return res.status(200).json(data)
}