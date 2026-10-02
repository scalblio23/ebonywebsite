// POST /api/booking-details { id, name, email, phone }
// After paying, the customer adds their contact details on the thank-you page.
// Fills in the paid booking in the admin list and sends the confirmation emails.
// The booking id (32 random hex chars) is the customer's proof of ownership.

const { redis, storageConfigured, readBody, KEEP_SECONDS } = require('./_lib/store');
const { customerConfirmation, studioNotification, sendEmails } = require('./_lib/emails');

function validate(b) {
  const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (typeof b.id !== 'string' || !/^[a-f0-9]{32}$/.test(b.id)) return 'Invalid booking.';
  if (!str(b.name, 120)) return 'Please enter your name.';
  if (!str(b.email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) return 'Please enter a valid email address.';
  if (!str(b.phone, 40) || b.phone.replace(/\D/g, '').length < 8) return 'Please enter a valid phone number.';
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!storageConfigured()) return res.status(503).json({ error: 'Online booking is not set up yet.' });

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid request.' });
  const error = validate(body);
  if (error) return res.status(400).json({ error });

  const id = body.id;
  const details = { name: body.name.trim(), email: body.email.trim(), phone: body.phone.trim() };

  try {
    const [rawHold, rawRecord, done] = await redis(
      ['GET', `hold:${id}`], ['GET', `record:${id}`], ['GET', `details:${id}`],
    );
    if (!rawHold) return res.status(404).json({ error: 'Booking not found.' });
    if (done) return res.status(200).json({ ok: true, already: true });
    if (!rawRecord) return res.status(409).json({ error: 'Your payment is still being confirmed. Please try again in a moment.' });

    // Only the first submission counts.
    const [claimed] = await redis(['SET', `details:${id}`, '1', 'NX', 'EX', KEEP_SECONDS]);
    if (claimed !== 'OK') return res.status(200).json({ ok: true, already: true });

    let booking;
    try {
      const { slug, index } = JSON.parse(rawRecord);
      const [rawBooking] = await redis(['LINDEX', `bookings:${slug}`, index]);
      booking = { ...JSON.parse(rawBooking), ...details, detailsComplete: true };
      booking.notes = `Paid $${Number(booking.price).toFixed(2)} via Whop`;
      await redis(
        ['LSET', `bookings:${slug}`, index, JSON.stringify(booking)],
        ['SET', `hold:${id}`, JSON.stringify({ ...JSON.parse(rawHold), ...details }), 'KEEPTTL'],
      );
    } catch (err) {
      await redis(['DEL', `details:${id}`]).catch(() => {}); // let the customer try again
      throw err;
    }

    let emailed = true;
    try {
      await sendEmails([
        customerConfirmation(booking),
        studioNotification(booking, { title: 'Booking details received' }),
      ]);
    } catch (err) {
      emailed = false;
      console.error('booking detail emails failed for', id, err);
    }
    return res.status(200).json({ ok: true, emailed });
  } catch (err) {
    console.error('booking details failed', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
