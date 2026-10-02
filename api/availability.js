// GET /api/availability?workshop=beginners — public list of bookable sessions.
const { getConfig, getBookedCounts, todayIso, seatsFor, storageConfigured } = require('./_lib/store');
const { publicConfig } = require('./_lib/square');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!storageConfigured()) return res.status(503).json({ error: 'Online booking is not set up yet.' });

  const slug = String(req.query.workshop || '');
  try {
    const config = await getConfig();
    const w = config.workshops[slug];
    if (!w) return res.status(404).json({ error: 'Unknown workshop.' });

    const counts = await getBookedCounts(slug);
    const today = todayIso();
    const dates = Object.keys(w.dates).sort()
      .filter(date => date > today)
      .map(date => {
        const seats = seatsFor(w, date);
        const slots = (w.dates[date].times || [])
          .filter(t => w.times.includes(t))
          .map(time => ({ time, left: Math.max(0, seats - (counts[`${date}|${time}`] || 0)) }));
        return { date, slots };
      })
      .filter(d => d.slots.length);

    return res.status(200).json({ name: w.name, price: w.price, dates, square: publicConfig() });
  } catch (err) {
    console.error('availability failed', err);
    return res.status(500).json({ error: 'Could not load availability.' });
  }
};
