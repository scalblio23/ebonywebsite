// POST /api/admin/bookings { bookings: [{ workshop, date, time, name, email, phone, notes }] }
// Adds bookings by hand (no emails sent). Opens the date/time if needed and
// skips anyone already booked into the same session. Admin only.
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
  const list = body && Array.isArray(body.bookings) ? body.bookings.slice(0, 500) : null;
  if (!list) return res.status(400).json({ error: 'Send { bookings: [...] }.' });

  const rows = [];
  for (const [i, b] of list.entries()) {
    const row = {
      slug: str(b.workshop, 40),
      date: str(b.date, 10),
      time: str(b.time, 60),
      name: str(b.name, 120),
      email: str(b.email, 200),
      phone: str(b.phone, 40),
      notes: str(b.notes, 500),
    };
    if (!WORKSHOPS[row.slug] || !ISO.test(row.date) || !row.time || !row.name) {
      return res.status(400).json({ error: `Row ${i + 1} is missing a valid workshop, date, time or name.` });
    }
    rows.push(row);
  }

  try {
    const config = await getConfig();
    const slugs = [...new Set(rows.map(r => r.slug))];
    const lists = await redis(...slugs.map(s => ['LRANGE', `bookings:${s}`, 0, -1]));
    const existing = new Set();
    slugs.forEach((s, i) => (lists[i] || []).forEach(x => {
      const b = JSON.parse(x);
      existing.add(`${s}|${b.date}|${b.time}|${String(b.name).toLowerCase()}`);
    }));

    const commands = [];
    let added = 0;
    let skipped = 0;
    for (const r of rows) {
      const w = config.workshops[r.slug];
      if (!w.times.includes(r.time)) w.times.push(r.time);
      const d = w.dates[r.date] || (w.dates[r.date] = { times: [], seats: null });
      if (!d.times.includes(r.time)) d.times.push(r.time);

      const key = `${r.slug}|${r.date}|${r.time}|${r.name.toLowerCase()}`;
      if (existing.has(key)) {
        skipped++;
        continue;
      }
      existing.add(key);
      const record = {
        workshop: w.name, date: r.date, time: r.time, price: w.price,
        name: r.name, email: r.email, phone: r.phone, notes: r.notes,
        slug: r.slug, source: 'manual', createdAt: new Date().toISOString(),
      };
      commands.push(
        ['RPUSH', `bookings:${r.slug}`, JSON.stringify(record)],
        ['HINCRBY', `booked:${r.slug}`, `${r.date}|${r.time}`, 1],
      );
      added++;
    }

    await saveConfig(config);
    if (commands.length) await redis(...commands);
    return res.status(200).json({ added, skipped });
  } catch (err) {
    console.error('manual bookings failed', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
