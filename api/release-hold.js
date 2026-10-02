// POST /api/release-hold { id } — the customer went back from payment, so free
// their held seat now instead of waiting for the 30-minute hold to expire.
// Paid bookings are never released (the webhook removes them from "holds").
const { redis, storageConfigured, readBody } = require('./_lib/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const body = readBody(req);
  const id = body && typeof body.id === 'string' ? body.id : '';
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: 'Invalid booking.' });
  if (!storageConfigured()) return res.status(503).json({ error: 'Online booking is not set up yet.' });

  try {
    const [removed, raw] = await redis(['ZREM', 'holds', id], ['GET', `hold:${id}`]);
    if (removed === 1 && raw) {
      const h = JSON.parse(raw);
      await redis(['HINCRBY', `booked:${h.slug}`, `${h.date}|${h.time}`, -1]);
    }
    return res.status(200).json({ ok: true, released: removed === 1 });
  } catch (err) {
    console.error('release hold failed', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
