// Square Payments API helpers. The card form on the booking page (Square Web
// Payments SDK) turns the card into a one-time token; the server charges it here.
//
// Environment variables:
//   SQUARE_APPLICATION_ID  (required) Application ID from the Square Developer Dashboard (public)
//   SQUARE_ACCESS_TOKEN    (required) Access token (secret — server only)
//   SQUARE_LOCATION_ID     (required) location that takes the payments
//   SQUARE_ENVIRONMENT     (optional) "sandbox" or "production" (default "sandbox")

const SQUARE_VERSION = '2024-10-17';

function squareConfigured() {
  return !!(process.env.SQUARE_APPLICATION_ID && process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

function environment() {
  return process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}

// Safe to send to the browser: the card form needs these to load.
function publicConfig() {
  if (!squareConfigured()) return null;
  return {
    applicationId: process.env.SQUARE_APPLICATION_ID,
    locationId: process.env.SQUARE_LOCATION_ID,
    environment: environment(),
  };
}

async function square(method, path, body) {
  const base = environment() === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  const r = await fetch(`${base}${path}`, {
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
    const errors = data.errors || [];
    const err = new Error(`Square ${method} ${path} failed (${errors.map(e => `${e.code}: ${e.detail}`).join('; ') || r.status})`);
    err.squareErrors = errors;
    throw err;
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

const CARD_MESSAGES = {
  CARD_DECLINED: 'Your card was declined. Please try another card.',
  GENERIC_DECLINE: 'Your card was declined. Please try another card.',
  INSUFFICIENT_FUNDS: 'Your card was declined (insufficient funds). Please try another card.',
  CVV_FAILURE: 'The security code (CVV) is incorrect. Please check and try again.',
  ADDRESS_VERIFICATION_FAILURE: 'The postcode does not match your card. Please check and try again.',
  INVALID_EXPIRATION: 'The expiry date is invalid. Please check and try again.',
  INVALID_CARD: 'This card is invalid. Please try another card.',
  CARD_EXPIRED: 'This card has expired. Please try another card.',
  CARD_NOT_SUPPORTED: 'This card type is not supported. Please try another card.',
  CARD_DECLINED_VERIFICATION_REQUIRED: 'Your bank needs to verify this payment. Please try another card.',
};

// Charges the card token. Returns the Square payment, or throws an error with
// .userMessage set when the card itself was the problem (declined etc.).
async function chargeCard({ sourceId, idempotencyKey, price, email, note }) {
  try {
    const { payment } = await square('POST', '/v2/payments', {
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      amount_money: { amount: Math.round(price * 100), currency: await locationCurrency() },
      location_id: process.env.SQUARE_LOCATION_ID,
      buyer_email_address: email,
      note: note.slice(0, 500),
    });
    return payment;
  } catch (err) {
    const code = (err.squareErrors || []).map(e => e.code).find(c => CARD_MESSAGES[c]);
    if (code) err.userMessage = CARD_MESSAGES[code];
    throw err;
  }
}

module.exports = { squareConfigured, publicConfig, chargeCard };
