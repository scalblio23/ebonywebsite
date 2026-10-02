// GET /api/booking-status?id=... — lets the booking page show "confirmed"
// after the customer pays (or returns from Whop checkout).
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
    const [raw, record, details] = await redis(
      ['GET', `hold:${id}`], ['GET', `record:${id}`], ['GET', `details:${id}`],
    );
    if (!raw) return res.status(404).json({ error: 'Booking not found.' });
    const h = JSON.parse(raw);
    // "paid" once the webhook has saved the booking; detailsComplete once the
    // customer has entered their name/email/phone.
    let contact = {};
    if (record && !details) {
      const { slug, index } = JSON.parse(record);
      const [b] = await redis(['LINDEX', `bookings:${slug}`, index]);
      if (b) { const r = JSON.parse(b); contact = { name: r.name, email: r.email, phone: r.phone }; }
    }
    return res.status(200).json({
      status: record ? 'paid' : 'pending',
      detailsComplete: !!details,
      ...contact,
      slug: h.slug, workshop: h.workshop, date: h.date, time: h.time, price: h.price,
      name: h.name || contact.name || '', email: h.email || contact.email || '',
    });
  } catch (err) {
    console.error('booking status failed', err);
    return res.status(500).json({ error: 'Could not load booking.' });
  }
};
