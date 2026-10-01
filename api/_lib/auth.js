// Admin login: credentials come from env vars, sessions are HMAC-signed cookies.
//   ADMIN_EMAIL     (optional) defaults to ebonyhead@gmail.com
//   ADMIN_PASSWORD  (required) the admin password
//   ADMIN_SECRET    (optional) signing key for sessions; defaults to one derived from ADMIN_PASSWORD
const crypto = require('crypto');

const COOKIE = 'ef_admin';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function adminEmail() {
  return (process.env.ADMIN_EMAIL || 'ebonyhead@gmail.com').trim().toLowerCase();
}

function secret() {
  const s = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) return null;
  return crypto.createHash('sha256').update(`ef-admin:${s}`).digest();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkCredentials(email, password) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  const emailOk = safeEqual(String(email || '').trim().toLowerCase(), adminEmail());
  const pwOk = safeEqual(String(password || ''), pw);
  return emailOk && pwOk;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ sub: adminEmail(), exp: Date.now() + MAX_AGE * 1000 })).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function isAdmin(req) {
  if (!secret()) return false;
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const token = cookies[COOKIE];
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!safeEqual(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.sub === adminEmail() && data.exp > Date.now();
  } catch {
    return false;
  }
}

module.exports = { checkCredentials, sessionCookie, clearCookie, isAdmin };
