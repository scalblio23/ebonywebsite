// POST /api/square-webhook — Square calls this when a payment changes.
// When a payment is COMPLETED it confirms the held booking, adds it to the
// admin bookings list and sends the confirmation emails.
//
// In Square Developer Dashboard → Webhooks → Add subscription:
//   URL:   https://<your site>/api/square-webhook
//   Event: payment.updated
// then add its Signature Key to Vercel as SQUARE_WEBHOOK_SIGNATURE_KEY.

const { redis, getConfig, seatsFor, KEEP_SECONDS } = require('./_lib/store');
const { verifySignature } = require('./_lib/square');
const { sendBookingEmails } = require('./_lib/emails');

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function notificationUrl(req) {
  if (process.env.SQUARE_WEBHOOK_URL) return process.env.SQUARE_WEBHOOK_URL;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}/api/square-webhook`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = await rawBody(req);
  if (!verifySignature(body, req.headers['x-square-hmacsha256-signature'], notificationUrl(req))) {
    console.error('Square webhook signature check failed (check SQUARE_WEBHOOK_SIGNATURE_KEY and the webhook URL)');
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  let event;
  try { event = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
  const payment = event && event.data && event.data.object && event.data.object.payment;
  if (!payment || payment.status !== 'COMPLETED' || !payment.order_id) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const [id] = await redis(['GET', `order:${payment.order_id}`]);
    if (!id) {
      console.error('Square payment for unknown order', payment.order_id, payment.id);
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Square retries webhooks; only the first delivery confirms the booking.
    const [claimed] = await redis(['SET', `paid:${id}`, payment.id, 'NX', 'EX', KEEP_SECONDS]);
    if (claimed !== 'OK') return res.status(200).json({ ok: true, duplicate: true });

    const [removed, raw] = await redis(['ZREM', 'holds', id], ['GET', `hold:${id}`]);
    if (!raw) {
      console.error('Square payment for a booking with no stored details', id, payment.id);
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

    const paid = payment.amount_money ? payment.amount_money.amount / 100 : h.price;
    const record = {
      workshop: h.workshop, date: h.date, time: h.time, price: h.price,
      name: h.name, email: h.email, phone: h.phone,
      notes: `Paid $${paid.toFixed(2)} via Square`,
      paid: true, paymentId: payment.id, orderId: payment.order_id,
      slug: h.slug, source: 'square', createdAt: h.createdAt, paidAt: new Date().toISOString(),
    };
    await redis(['RPUSH', `bookings:${h.slug}`, JSON.stringify(record)]);

    try {
      await sendBookingEmails({ ...h, price: paid }, studioNote);
    } catch (err) {
      // The booking is paid and recorded; don't make Square retry over an email failure.
      console.error('booking emails failed for', id, err);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Square webhook failed', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};
