// GET /api/booking-status?id=... — lets the booking page show "confirmed"
// after the customer returns from Square checkout.
const { redis, storageConfigured } = require('./_lib/store');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const id = String(req.query.id || '');
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: 'Invalid booking.' });
  if (!storageConfigured()) return res.status(503).json({ error: 'Online booking is not set up yet.' });

  try {
    const [raw, paid] = await redis(['GET', `hold:${id}`], ['GET', `paid:${id}`]);
    if (!raw) return res.status(404).json({ error: 'Booking not found.' });
    const h = JSON.parse(raw);
    return res.status(200).json({
      status: paid ? 'paid' : 'pending',
      workshop: h.workshop, date: h.date, time: h.time, price: h.price, email: h.email,
    });
  } catch (err) {
    console.error('booking status failed', err);
    return res.status(500).json({ error: 'Could not load booking.' });
  }
};
