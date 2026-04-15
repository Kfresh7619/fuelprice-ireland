import { runScraper } from '../scraper/oilprice'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const token = req.headers['x-admin-token']
  if (token !== process.env.ADMIN_REFRESH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorised' })
  }

  const results = await runScraper()
  return res.status(results.error ? 500 : 200).json(results)
}