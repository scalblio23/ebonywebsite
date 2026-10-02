// Square Checkout API helpers (payment links + webhook verification).
//
// Environment variables:
//   SQUARE_ACCESS_TOKEN           (required) access token from the Square Developer Dashboard
//   SQUARE_LOCATION_ID            (required) location that takes the payments
//   SQUARE_ENVIRONMENT            (optional) "sandbox" or "production" (default "sandbox")
//   SQUARE_WEBHOOK_SIGNATURE_KEY  (required for the webhook) shown on the webhook subscription in Square
//   SQUARE_WEBHOOK_URL            (optional) exact notification URL registered in Square, if it differs
//                                 from https://<this site>/api/square-webhook

const crypto = require('crypto');

const SQUARE_VERSION = '2024-10-17';

function squareConfigured() {
  return !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

function baseUrl() {
  return process.env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

async function square(method, path, body) {
  const r = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = (data.errors || []).map(e => `${e.code}: ${e.detail}`).join('; ') || r.status;
    throw new Error(`Square ${method} ${path} failed (${detail})`);
  }
  return data;
}

// The location's currency (AUD for an Australian account). Cached per instance.
let currency;
async function locationCurrency() {
  if (!currency) {
    const { location } = await square('GET', `/v2/locations/${encodeURIComponent(process.env.SQUARE_LOCATION_ID)}`);
    currency = location.currency;
  }
  return currency;
}

// Creates a one-off Square checkout page; returns { url, orderId }.
async function createPaymentLink({ bookingId, name, price, email, redirectUrl }) {
  const { payment_link: link } = await square('POST', '/v2/online-checkout/payment-links', {
    idempotency_key: bookingId,
    quick_pay: {
      name,
      price_money: { amount: Math.round(price * 100), currency: await locationCurrency() },
      location_id: process.env.SQUARE_LOCATION_ID,
    },
    checkout_options: { redirect_url: redirectUrl },
    pre_populated_data: { buyer_email: email },
    payment_note: `Booking ${bookingId}`,
  });
  return { url: link.url, orderId: link.order_id };
}

// Square signs base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)).
function verifySignature(rawBody, signature, notificationUrl) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !signature) return false;
  const expected = crypto.createHmac('sha256', key).update(notificationUrl + rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { squareConfigured, createPaymentLink, verifySignature };
