// GET /api/admin/config — availability settings + bookings (admin only).
// PUT /api/admin/config { workshops } — save availability settings.
const { isAdmin } = require('../_lib/auth');
const {
  WORKSHOPS, redis, storageConfigured, getConfig, saveConfig, getBookedCounts, readBody,
} = require('../_lib/store');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function cleanTime(t) {
  return typeof t === 'string' ? t.trim().slice(0, 60) : '';
}

function sanitize(input, current) {
  const out = { workshops: {} };
  for (const slug of Object.keys(WORKSHOPS)) {
    const w = (input.workshops || {})[slug];
    const cur = current.workshops[slug];
    if (!w || typeof w !== 'object') {
      out.workshops[slug] = cur;
      continue;
    }
    const times = [...new Set((Array.isArray(w.times) ? w.times : []).map(cleanTime).filter(Boolean))].slice(0, 12);
    const dates = {};
    for (const [date, d] of Object.entries(w.dates && typeof w.dates === 'object' ? w.dates : {})) {
      if (!ISO.test(date) || !d || typeof d !== 'object') continue;
      const seats = d.seats === null || d.seats === '' ? NaN : Number(d.seats);
      dates[date] = {
        times: [...new Set((Array.isArray(d.times) ? d.times : []).map(cleanTime))].filter(t => times.includes(t)),
        seats: Number.isInteger(seats) && seats >= 0 && seats <= 500 ? seats : null,
      };
    }
    const price = Number(w.price);
    const seatLimit = Number(w.seatLimit);
    out.workshops[slug] = {
      name: WORKSHOPS[slug].name,
      price: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : cur.price,
      seatLimit: Number.isInteger(seatLimit) && seatLimit >= 1 && seatLimit <= 500 ? seatLimit : cur.seatLimit,
      times,
      dates,
    };
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please log in.' });
  if (!storageConfigured()) {
    return res.status(503).json({ error: 'Storage is not set up yet. In Vercel, open Storage and add Upstash Redis to this project, then redeploy.' });
  }

  try {
    if (req.method === 'GET') {
      const config = await getConfig();
      const slugs = Object.keys(config.workshops);
      const booked = {};
      const bookings = {};
      const lists = await redis(...slugs.map(s => ['LRANGE', `bookings:${s}`, -500, -1]));
      for (let i = 0; i < slugs.length; i++) {
        booked[slugs[i]] = await getBookedCounts(slugs[i]);
        bookings[slugs[i]] = (lists[i] || []).map(x => JSON.parse(x));
      }
      return res.status(200).json({ ...config, booked, bookings });
    }

    if (req.method === 'PUT') {
      const body = readBody(req);
      if (!body) return res.status(400).json({ error: 'Invalid request.' });
      const config = sanitize(body, await getConfig());
      await saveConfig(config);
      return res.status(200).json(config);
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('admin config failed', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
