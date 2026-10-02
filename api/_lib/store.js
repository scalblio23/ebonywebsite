// Storage (Upstash Redis REST API) + availability config shared by the API routes.
// Add Upstash Redis to the Vercel project (Storage tab) and it sets these env vars:
//   KV_REST_API_URL / KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)

const WORKSHOPS = {
  'beginners': { name: 'Beginners Hand-building', price: 98, seatLimit: 10, times: ['10:00am – 12:00pm', '1:00pm – 3:00pm'] },
  '6-week': { name: '6 Week Course', price: 550, seatLimit: 8, times: ['6:00pm – 8:30pm'] },
  'dinner-set': { name: 'Build Your Own Dinner Set', price: 420, seatLimit: 5, times: ['10:00am – 2:00pm'] },
  'serving-ware': { name: 'Build Your Own Serving Ware', price: 180, seatLimit: 10, times: ['10:00am – 12:30pm'] },
  'vases': { name: 'Vases and Flower Arranging Workshop', price: 280, seatLimit: 10, times: ['10:00am – 2:00pm'] },
};

function redisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function storageConfigured() {
  return !!redisEnv();
}

// Run several Redis commands in one request; returns an array of results.
async function redis(...commands) {
  const env = redisEnv();
  if (!env) throw new Error('Storage is not configured (add Upstash Redis in Vercel → Storage).');
  const r = await fetch(`${env.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`Redis error ${r.status}: ${await r.text()}`);
  const out = await r.json();
  return out.map(x => {
    if (x.error) throw new Error(`Redis error: ${x.error}`);
    return x.result;
  });
}

function defaultConfig() {
  const workshops = {};
  for (const [slug, w] of Object.entries(WORKSHOPS)) {
    workshops[slug] = { ...w, times: [...w.times], dates: {} };
  }
  return { workshops };
}

// Merge stored config over defaults so newly added workshops always appear.
async function getConfig() {
  const [raw] = await redis(['GET', 'config']);
  const config = defaultConfig();
  if (!raw) return config;
  const stored = JSON.parse(raw);
  for (const slug of Object.keys(config.workshops)) {
    if (stored.workshops && stored.workshops[slug]) {
      config.workshops[slug] = { ...config.workshops[slug], ...stored.workshops[slug] };
    }
  }
  return config;
}

async function saveConfig(config) {
  await redis(['SET', 'config', JSON.stringify(config)]);
}

// { "YYYY-MM-DD|time": count } of seats booked for a workshop
async function getBookedCounts(slug) {
  const [flat] = await redis(['HGETALL', `booked:${slug}`]);
  const counts = {};
  for (let i = 0; i < (flat || []).length; i += 2) counts[flat[i]] = Number(flat[i + 1]) || 0;
  return counts;
}

function todayIso() {
  // Studio is in Adelaide; compare dates in that timezone.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Adelaide' }).format(new Date());
}

function seatsFor(workshop, date) {
  const d = workshop.dates[date];
  return d && Number.isInteger(d.seats) ? d.seats : workshop.seatLimit;
}

function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  return body && typeof body === 'object' ? body : null;
}

// --- Seat holds while a customer pays on Whop -------------------------------
// hold:<id>   pending booking JSON (kept 7 days so late payments still match)
// holds       sorted set of hold ids, scored by when the hold expires
// plan:<id>   Whop plan id -> hold id (each booking gets its own one-time plan)
// paid:<id>   set once the payment is confirmed (stops double-processing)

const HOLD_MINUTES = 30;
const KEEP_SECONDS = 7 * 24 * 60 * 60;

// Releases the seat of every unpaid hold past its expiry.
async function releaseExpiredHolds() {
  const [ids] = await redis(['ZRANGEBYSCORE', 'holds', 0, Date.now(), 'LIMIT', 0, 50]);
  for (const id of ids || []) {
    const [removed, raw] = await redis(['ZREM', 'holds', id], ['GET', `hold:${id}`]);
    if (removed !== 1 || !raw) continue; // someone else (or the webhook) got there first
    const h = JSON.parse(raw);
    await redis(['HINCRBY', `booked:${h.slug}`, `${h.date}|${h.time}`, -1]);
  }
}

async function createHold(id, hold) {
  await redis(
    ['SET', `hold:${id}`, JSON.stringify(hold), 'EX', KEEP_SECONDS],
    ['ZADD', 'holds', Date.now() + HOLD_MINUTES * 60 * 1000, id],
  );
}

module.exports = {
  WORKSHOPS, redis, storageConfigured, getConfig, saveConfig, getBookedCounts,
  todayIso, seatsFor, readBody, releaseExpiredHolds, createHold, KEEP_SECONDS,
};
