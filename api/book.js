// POST /api/book — charges the card (Square) and confirms the booking.
// Reserves a seat, takes payment with the card token from the booking page,
// then records the booking and emails the customer and the studio.

const crypto = require('crypto');
const {
  redis, storageConfigured, getConfig, todayIso, seatsFor, readBody,
} = require('./_lib/store');
const { squareConfigured, chargeCard } = require('./_lib/square');
const { sendBookingEmails } = require('./_lib/emails');

function validate(b) {
  const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (!str(b.workshop, 40)) return 'Missing workshop.';
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return 'Invalid date.';
  if (!str(b.time, 60)) return 'Missing time.';
  if (!str(b.name, 120)) return 'Please enter your name.';
  if (!str(b.email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) return 'Please enter a valid email address.';
  if (!str(b.phone, 40) || b.phone.replace(/\D/g, '').length < 8) return 'Please enter a valid phone number.';
  if (!str(b.sourceId, 500)) return 'Please enter your card details.';
  return '';
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

  if (!storageConfigured() || !squareConfigured()) {
    console.error('Booking unavailable: storage or Square env vars missing');
    return res.status(503).json({ error: 'Online booking is not set up yet.' });
  }

  const slug = body.workshop.trim();
  const date = body.date;
  const time = body.time.trim();

  let workshop;
  try {
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

  // Reserve a seat atomically; roll back if the session is full or payment fails.
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

  const b = {
    workshop: workshop.name,
    date,
    time,
    price: workshop.price,
    name: body.name.trim(),
    email: body.email.trim(),
    phone: body.phone.trim(),
  };

  let payment;
  try {
    payment = await chargeCard({
      sourceId: body.sourceId,
      idempotencyKey: crypto.randomUUID(),
      price: b.price,
      email: b.email,
      note: `${b.workshop} – ${date} ${time} – ${b.name}`,
    });
  } catch (err) {
    console.error('payment failed', err);
    await release();
    return res.status(402).json({ error: err.userMessage || 'We could not process your payment. Please try again.' });
  }

  const record = {
    ...b, slug,
    notes: `Paid $${Number(b.price).toFixed(2)} via Square`,
    paid: true, paymentId: payment.id, source: 'square',
    createdAt: new Date().toISOString(),
  };
  await redis(['RPUSH', `bookings:${slug}`, JSON.stringify(record)])
    .catch(e => console.error('booking record failed — PAID booking not saved:', JSON.stringify(record), e));

  try {
    await sendBookingEmails(b);
  } catch (err) {
    // Payment went through and the seat is booked; don't report failure to the customer.
    console.error('booking emails failed', err);
  }
  return res.status(200).json({ ok: true });
};
