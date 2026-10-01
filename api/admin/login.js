// POST /api/admin/login { email, password } — sets the admin session cookie.
const { checkCredentials, sessionCookie } = require('../_lib/auth');
const { redis, storageConfigured, readBody } = require('../_lib/store');

const MAX_FAILS = 10;
const WINDOW = 15 * 60; // seconds

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin login is not configured yet (ADMIN_PASSWORD missing).' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const failKey = `loginfail:${ip}`;
  if (storageConfigured()) {
    const [fails] = await redis(['GET', failKey]).catch(() => [0]);
    if (Number(fails) >= MAX_FAILS) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
    }
  }

  const body = readBody(req) || {};
  if (!checkCredentials(body.email, body.password)) {
    if (storageConfigured()) await redis(['INCR', failKey], ['EXPIRE', failKey, WINDOW]).catch(() => {});
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  res.setHeader('Set-Cookie', sessionCookie());
  return res.status(200).json({ ok: true });
};
