// POST /api/admin/reschedule
//   { booking: { slug, date, time, name, createdAt }, to: { workshop, date, time } }
// Moves one student to another class, date and/or time (no emails sent). Admin only.
//
// Booking lists are never shortened: /api/booking-details finds a paid booking
// by its list index, so removing an entry would shift everyone after it.
// Same class → the record is updated in place. Different class → the old entry
// is marked movedTo (hidden from the admin) and a copy is added to the new class.
const { isAdmin } = require('../_lib/auth');
const { WORKSHOPS, redis, storageConfigured, getConfig, saveConfig, readBody } = require('../_lib/store');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please log in.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!storageConfigured()) return res.status(503).json({ error: 'Storage is not set up yet.' });

  const body = readBody(req);
  const from = body && body.booking;
  const to = body && body.to;
  if (!from || !to || !WORKSHOPS[from.slug] || typeof from.name !== 'string') {
    return res.status(400).json({ error: 'Invalid booking.' });
  }
  const target = { slug: str(to.workshop, 40), date: str(to.date, 10), time: str(to.time, 60) };
  if (!WORKSHOPS[target.slug] || !ISO.test(target.date) || !target.time) {
    return res.status(400).json({ error: 'Choose a class, date and time.' });
  }

  try {
    const [fromList, toList] = await redis(
      ['LRANGE', `bookings:${from.slug}`, 0, -1],
      ['LRANGE', `bookings:${target.slug}`, 0, -1],
    );
    const index = (fromList || []).findIndex(x => {
      const b = JSON.parse(x);
      return !b.movedTo && b.date === from.date && b.time === from.time
        && b.name === from.name && (b.createdAt || '') === (from.createdAt || '');
    });
    if (index < 0) return res.status(409).json({ error: 'That booking has changed. Please reload the page and try again.' });
    const old = JSON.parse(fromList[index]);

    if (old.date === target.date && old.time === target.time && from.slug === target.slug) {
      return res.status(400).json({ error: `${old.name} is already in that class.` });
    }
    const clash = (toList || []).some(x => {
      const b = JSON.parse(x);
      return !b.movedTo && b.date === target.date && b.time === target.time
        && String(b.name).toLowerCase() === String(old.name).toLowerCase();
    });
    if (clash) return res.status(409).json({ error: `${old.name} is already booked into that class.` });

    // Open the new date/time if it isn't already.
    const config = await getConfig();
    const w = config.workshops[target.slug];
    if (!w.times.includes(target.time)) w.times.push(target.time);
    const d = w.dates[target.date] || (w.dates[target.date] = { times: [], seats: null });
    if (!d.times.includes(target.time)) d.times.push(target.time);
    await saveConfig(config);

    const now = new Date().toISOString();
    const moved = {
      ...old,
      workshop: w.name, slug: target.slug, date: target.date, time: target.time,
      rescheduledFrom: { workshop: old.workshop, date: old.date, time: old.time },
      rescheduledAt: now,
    };
    const commands = from.slug === target.slug
      ? [['LSET', `bookings:${from.slug}`, index, JSON.stringify(moved)]]
      : [
        ['LSET', `bookings:${from.slug}`, index, JSON.stringify({ ...old, movedTo: { slug: target.slug, date: target.date, time: target.time }, movedAt: now })],
        ['RPUSH', `bookings:${target.slug}`, JSON.stringify(moved)],
      ];
    commands.push(
      ['HINCRBY', `booked:${from.slug}`, `${old.date}|${old.time}`, -1],
      ['HINCRBY', `booked:${target.slug}`, `${target.date}|${target.time}`, 1],
    );
    await redis(...commands);
    return res.status(200).json({ ok: true, booking: moved });
  } catch (err) {
    console.error('reschedule failed', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
