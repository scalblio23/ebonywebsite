// POST /api/whop-webhook — Whop calls this when a payment succeeds.
// Confirms the held booking, adds it to the admin bookings list and sends the
// confirmation emails.
//
// Whop dashboard → Developer → Webhooks:
//   URL:   https://<your site>/api/whop-webhook
//   Event: payment.succeeded
// then add its secret to Vercel as WHOP_WEBHOOK_SECRET.

const { redis, getConfig, seatsFor, KEEP_SECONDS } = require('./_lib/store');
const { verifyWebhook } = require('./_lib/whop');
const { sendBookingEmails } = require('./_lib/emails');

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Find our booking id on the payment: metadata first, then the per-booking plan.
async function bookingIdFor(payment) {
  const meta = payment.metadata || {};
  const checkoutMeta = (payment.checkout_configuration && payment.checkout_configuration.metadata) || {};
  const planMeta = (payment.plan && payment.plan.metadata) || {};
  const direct = meta.booking_id || checkoutMeta.booking_id || planMeta.booking_id;
  if (direct) return String(direct);
  const planId = payment.plan_id || (payment.plan && payment.plan.id);
  if (!planId) return null;
  const [id] = await redis(['GET', `plan:${planId}`]);
  return id;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = await rawBody(req);
  if (!verifyWebhook(body, req.headers)) {
    console.error('Whop webhook signature check failed (check WHOP_WEBHOOK_SECRET)');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  let event;
  try { event = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
  const type = event.type || event.action;
  const payment = event.data;
  if (type !== 'payment.succeeded' || !payment) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const id = await bookingIdFor(payment);
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
      console.error('Whop payment not linked to a booking', payment.id);
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Whop retries webhooks; only the first delivery confirms the booking.
    const [claimed] = await redis(['SET', `paid:${id}`, payment.id || '1', 'NX', 'EX', KEEP_SECONDS]);
    if (claimed !== 'OK') return res.status(200).json({ ok: true, duplicate: true });

    const [removed, raw] = await redis(['ZREM', 'holds', id], ['GET', `hold:${id}`]);
    if (!raw) {
      console.error('Whop payment for a booking with no stored details', id, payment.id);
      return res.status(200).json({ ok: true, ignored: true });
    }
    const h = JSON.parse(raw);
    let studioNote = '';
    if (removed !== 1) {
      // The 30-minute hold had already lapsed and the seat was released; take it back.
      const [taken] = await redis(['HINCRBY', `booked:${h.slug}`, `${h.date}|${h.time}`, 1]);
      const w = (await getConfig()).workshops[h.slug];
      if (w && taken > seatsFor(w, h.date)) {
        studioNote = `Heads up: this customer paid after their 30-minute hold expired and the session is now over capacity (${taken} booked).`;
      }
    }

    const paid = Number(h.price); // the checkout was created at exactly this price
    const record = {
      workshop: h.workshop, date: h.date, time: h.time, price: h.price,
      name: h.name, email: h.email, phone: h.phone,
      notes: `Paid $${paid.toFixed(2)} via Whop`,
      paid: true, paymentId: payment.id, source: 'whop',
      slug: h.slug, createdAt: h.createdAt, paidAt: new Date().toISOString(),
    };
    await redis(['RPUSH', `bookings:${h.slug}`, JSON.stringify(record)]);

    try {
      await sendBookingEmails({ ...h, price: paid }, studioNote);
    } catch (err) {
      // The booking is paid and recorded; don't make Whop retry over an email failure.
      console.error('booking emails failed for', id, err);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Whop webhook failed', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
