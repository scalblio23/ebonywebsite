// Whop helpers: one-off checkouts for bookings + webhook signature checks.
//
// Environment variables:
//   WHOP_API_KEY         (required) company API key from the Whop dashboard (secret)
//   WHOP_COMPANY_ID      (required) your company id, starts with biz_
//   WHOP_WEBHOOK_SECRET  (required for the webhook) secret shown when creating the webhook
//   WHOP_PRODUCT_ID      (optional) attach booking plans to this product (prod_...)
//   WHOP_CURRENCY        (optional) default "aud"
//   WHOP_API_BASE        (optional) default https://api.whop.com/api/v1

const crypto = require('crypto');

const env = name => (process.env[name] || '').trim();

function whopConfigured() {
  return !!(env('WHOP_API_KEY') && env('WHOP_COMPANY_ID'));
}

async function whop(method, path, body) {
  const base = (env('WHOP_API_BASE') || 'https://api.whop.com/api/v1').replace(/\/$/, '');
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env('WHOP_API_KEY')}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* keep raw text for the error */ }
  if (!r.ok) {
    const msg = (data.error && (data.error.message || data.error.type)) || data.message || text.slice(0, 300) || r.status;
    const err = new Error(`Whop ${method} ${path} failed (${r.status}): ${msg}`);
    err.whopMessage = String(msg);
    throw err;
  }
  return data;
}

// Creates a one-time checkout for a booking. Returns { sessionId, planId, purchaseUrl }.
async function createCheckout({ bookingId, title, price, redirectUrl }) {
  const plan = {
    company_id: env('WHOP_COMPANY_ID'),
    plan_type: 'one_time',
    initial_price: Number(price),
    currency: (env('WHOP_CURRENCY') || 'aud').toLowerCase(),
    title: title.slice(0, 30), // Whop's maximum
    metadata: { booking_id: bookingId },
  };
  if (env('WHOP_PRODUCT_ID')) plan.product_id = env('WHOP_PRODUCT_ID');

  const data = await whop('POST', '/checkout_configurations', {
    plan,
    metadata: { booking_id: bookingId },
    redirect_url: redirectUrl,
  });
  const planId = data.plan_id || (data.plan && data.plan.id);
  if (!data.id || !planId) throw new Error(`Whop checkout response missing id/plan: ${JSON.stringify(data).slice(0, 300)}`);
  return { sessionId: data.id, planId, purchaseUrl: data.purchase_url };
}

// Whop signs webhooks with the Standard Webhooks scheme:
// base64(HMAC-SHA256(key, `${webhook-id}.${webhook-timestamp}.${rawBody}`)), sent as "v1,<sig>".
// Whop's guides disagree on how the secret maps to the key, so accept any of the
// documented forms (all derived from the secret, so this doesn't weaken the check).
function signingKeys(secret) {
  const keys = [Buffer.from(secret, 'utf8')];
  for (const s of [secret, secret.replace(/^(whsec_|ws_)/, '')]) {
    const b = Buffer.from(s, 'base64');
    if (b.length >= 16) keys.push(b);
  }
  return keys;
}

function verifyWebhook(rawBody, headers) {
  const secret = env('WHOP_WEBHOOK_SECRET');
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = String(headers['webhook-signature'] || '').split(' ')
    .map(s => s.split(',')[1]).filter(Boolean);
  if (!secret || !id || !timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;

  const content = `${id}.${timestamp}.${rawBody}`;
  return signingKeys(secret).some(key => {
    const expected = Buffer.from(crypto.createHmac('sha256', key).update(content).digest('base64'));
    return signatures.some(sig => {
      const got = Buffer.from(sig);
      return got.length === expected.length && crypto.timingSafeEqual(got, expected);
    });
  });
}

module.exports = { whopConfigured, createCheckout, verifyWebhook };
