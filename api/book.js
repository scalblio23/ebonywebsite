// POST /api/book — holds a seat and creates a Whop checkout for it.
// The seat is held for 30 minutes; the booking is confirmed (and emails sent)
// by /api/whop-webhook once Whop reports payment.succeeded.

const crypto = require('crypto');
const {
  redis, storageConfigured, getConfig, todayIso, seatsFor, readBody,
  releaseExpiredHolds, createHold, KEEP_SECONDS,
} = require('./_lib/store');
const { whopConfigured, createCheckout } = require('./_lib/whop');

// Page each workshop's booking widget lives on (customers return here after paying).
const PAGES = {
  'beginners': 'workshop-beginners.html',
  '6-week': 'workshop-6-week.html',
  'dinner-set': 'workshop-dinner-set.html',
  'serving-ware': 'workshop-serving-ware.html',
  'vases': 'workshop-vases.html',
};

function validate(b) {
  const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (!str(b.workshop, 40)) return 'Missing workshop.';
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return 'Invalid date.';
  if (!str(b.time, 60)) return 'Missing time.';
  if (!str(b.name, 120)) return 'Please enter your name.';
  if (!str(b.email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) return 'Please enter a valid email address.';
  if (!str(b.phone, 40) || b.phone.replace(/\D/g, '').length < 8) return 'Please enter a valid phone number.';
  return '';
}

function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid request.' });

  const error = validate(body);
  if (error) return res.status(400).json({ error });

  if (!storageConfigured() || !whopConfigured()) {
    console.error('Booking unavailable: storage or Whop env vars missing');
    return res.status(503).json({ error: 'Online booking is not set up yet.' });
  }

  const slug = body.workshop.trim();
  const date = body.date;
  const time = body.time.trim();

  let workshop;
  try {
    await releaseExpiredHolds();
    workshop = (await getConfig()).workshops[slug];
  } catch (err) {
    console.error('config load failed', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
  const session = workshop && workshop.dates[date];
  if (!session || date <= todayIso() || !session.times.includes(time) || !workshop.times.includes(time)) {
    return res.status(409).json({ error: 'That session is no longer available. Please pick another time.' });
  }
  if (!(workshop.price > 0)) {
    return res.status(409).json({ error: 'This workshop is not open for online payment. Please email the studio to book.' });
  }

  // Reserve a seat atomically; roll back if the session is full.
  const seatKey = `booked:${slug}`;
  const field = `${date}|${time}`;
  const seats = seatsFor(workshop, date);
  const release = () => redis(['HINCRBY', seatKey, field, -1]).catch(e => console.error('seat release failed', e));
  let taken;
  try {
    [taken] = await redis(['HINCRBY', seatKey, field, 1]);
  } catch (err) {
    console.error('seat reserve failed', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
  if (taken > seats) {
    await release();
    return res.status(409).json({ error: 'Sorry, that session just filled up. Please pick another time.' });
  }

  const id = crypto.randomBytes(16).toString('hex');
  const hold = {
    slug,
    workshop: workshop.name,
    date,
    time,
    price: workshop.price,
    name: body.name.trim(),
    email: body.email.trim(),
    phone: body.phone.trim(),
    createdAt: new Date().toISOString(),
  };

  try {
    const page = PAGES[slug] || 'workshops.html';
    const returnUrl = `${siteOrigin(req)}/${page}?booking=${id}#book`;
    const checkout = await createCheckout({
      bookingId: id,
      title: `${workshop.name} – ${date} ${time}`,
      price: workshop.price,
      redirectUrl: returnUrl,
    });
    await createHold(id, { ...hold, planId: checkout.planId, sessionId: checkout.sessionId });
    await redis(['SET', `plan:${checkout.planId}`, id, 'EX', KEEP_SECONDS]);
    return res.status(200).json({
      ok: true,
      bookingId: id,
      planId: checkout.planId,
      sessionId: checkout.sessionId,
      purchaseUrl: checkout.purchaseUrl,
      returnUrl,
    });
  } catch (err) {
    console.error('Whop checkout creation failed', err);
    await release();
    const detail = err.whopMessage ? ` (Whop: ${err.whopMessage})` : '';
    return res.status(502).json({ error: `We could not start the payment${detail}. Please try again or email ebonyfortunatow@gmail.com.` });
  }
};
