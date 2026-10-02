// GET /api/admin/square-check — plain-English check of the Square settings (admin only).
// Log in to the admin portal first, then open this URL in the same browser.
// Never shows the secret values themselves.
const { isAdmin } = require('../_lib/auth');

const BASES = {
  sandbox: 'https://connect.squareupsandbox.com',
  production: 'https://connect.squareup.com',
};

async function listLocations(env, token) {
  const r = await fetch(`${BASES[env]}/v2/locations`, {
    headers: { Authorization: `Bearer ${token}`, 'Square-Version': '2024-10-17' },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, locations: data.locations || [], errors: data.errors || [] };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (!isAdmin(req)) return res.status(401).send('Please log in to the admin portal first, then reload this page.');

  const lines = [];
  const ok = m => lines.push(`OK    ${m}`);
  const bad = m => lines.push(`FIX   ${m}`);

  const appId = (process.env.SQUARE_APPLICATION_ID || '').trim();
  const token = (process.env.SQUARE_ACCESS_TOKEN || '').trim();
  const locationId = (process.env.SQUARE_LOCATION_ID || '').trim();
  const rawEnv = (process.env.SQUARE_ENVIRONMENT || '').trim().toLowerCase();
  const env = rawEnv === 'production' ? 'production' : 'sandbox';

  for (const [name, v] of [['SQUARE_APPLICATION_ID', appId], ['SQUARE_ACCESS_TOKEN', token], ['SQUARE_LOCATION_ID', locationId]]) {
    if (v) ok(`${name} is set`);
    else bad(`${name} is missing in Vercel → Settings → Environment Variables (then redeploy).`);
  }
  if (rawEnv && rawEnv !== 'sandbox' && rawEnv !== 'production') {
    bad(`SQUARE_ENVIRONMENT is "${rawEnv}" — it must be exactly sandbox or production (lower case, no spaces).`);
  } else {
    ok(`Mode: ${env}${rawEnv ? '' : ' (SQUARE_ENVIRONMENT not set, so sandbox is used)'}`);
  }

  if (appId) {
    const appIsSandbox = appId.startsWith('sandbox-');
    if (appIsSandbox === (env === 'sandbox')) ok(`Application ID is a ${env} ID`);
    else bad(`Application ID is a ${appIsSandbox ? 'sandbox' : 'production'} ID but the mode is ${env}. Use the ${env} Application ID, or change SQUARE_ENVIRONMENT.`);
  }

  if (token) {
    const here = await listLocations(env, token);
    if (!here.ok) {
      const other = env === 'sandbox' ? 'production' : 'sandbox';
      const there = await listLocations(other, token);
      if (there.ok) {
        bad(`Access token is a ${other} token but the mode is ${env}. Use the ${env} access token, or change SQUARE_ENVIRONMENT.`);
      } else {
        bad(`Square rejected the access token (${here.errors.map(e => e.code).join(', ') || here.status}). Copy it again from the Square Developer Dashboard (${env}).`);
      }
    } else {
      ok(`Access token works in ${env}`);
      // The card form (Application ID) and the charge (Access token) must be the same app.
      const st = await fetch(`${BASES[env]}/oauth2/token/status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Square-Version': '2024-10-17', 'Content-Type': 'application/json' },
      }).then(r => r.json()).catch(() => ({}));
      if (st.client_id && appId) {
        if (st.client_id === appId) ok('Application ID and Access token are from the same app');
        else bad(`Application ID and Access token are from different apps. The token belongs to app ${st.client_id} — set SQUARE_APPLICATION_ID to that, or copy both from the same app's Credentials page.`);
      }
      if (st.merchant_id) ok(`Square account (merchant) ID: ${st.merchant_id}`);
      if (locationId) {
        const loc = here.locations.find(l => l.id === locationId);
        if (!loc) {
          const ids = here.locations.map(l => `${l.id} (${l.name})`).join(', ');
          bad(`Location ID ${locationId} is not in this ${env} account. Use one of: ${ids || 'none found'}.`);
        } else {
          ok(`Location: ${loc.name} (${loc.currency})`);
          if (loc.status !== 'ACTIVE') bad(`Location status is ${loc.status} — it must be ACTIVE.`);
          if (!(loc.capabilities || []).includes('CREDIT_CARD_PROCESSING')) {
            bad('This location cannot take card payments yet. Finish activating your Square account (identity + bank details) in the Square Dashboard.');
          } else {
            ok('Location can take card payments');
          }
        }
      }
    }
  }

  const problems = lines.filter(l => l.startsWith('FIX')).length;
  lines.push('', problems ? `${problems} thing(s) to fix. After changing anything in Vercel, redeploy and reload this page.` : 'All Square settings look right.');
  return res.status(200).send(lines.join('\n'));
};
