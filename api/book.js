// POST /api/book — emails booking details via Resend.
// Sends a confirmation to the customer and a notification to the studio.
//
// Environment variables:
//   RESEND_API_KEY      (required) Resend API key
//   BOOKING_FROM_EMAIL  (optional) verified sender, e.g. "Ebony Fortunatow <bookings@ebonyfortunatow.com>".
//                       Defaults to Resend's test sender, which only delivers to your Resend account email.
//   STUDIO_EMAIL        (optional) where studio notifications go; defaults to studio@ebonyfortunatow.com

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[date.getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

function validate(b) {
  const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (!str(b.workshop, 120)) return 'Missing workshop.';
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return 'Invalid date.';
  if (!str(b.time, 60)) return 'Missing time.';
  if (!str(b.name, 120)) return 'Please enter your name.';
  if (!str(b.email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) return 'Please enter a valid email address.';
  if (!str(b.phone, 40) || b.phone.replace(/\D/g, '').length < 8) return 'Please enter a valid phone number.';
  return '';
}

function detailsTable(b) {
  const rows = [
    ['Workshop', b.workshop],
    ['Date', longDate(b.date)],
    ['Time', b.time],
    ['Price', b.price ? `$${b.price} per person` : ''],
    ['Name', b.name],
    ['Email', b.email],
    ['Phone', b.phone],
    ['Location', '2 Ann St, Stepney SA 5069'],
  ].filter(([, v]) => v);
  return `<table style="border-collapse:collapse;font-size:14px;color:#3a3530">${rows.map(([k, v]) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#7a5c3e;text-transform:uppercase;font-size:11px;letter-spacing:.12em">${k}</td><td style="padding:6px 0">${esc(v)}</td></tr>`
  ).join('')}</table>`;
}

function wrap(inner) {
  return `<div style="font-family:Roboto,Helvetica,Arial,sans-serif;background:#f0ebe5;padding:32px">
    <div style="max-width:520px;margin:0 auto;background:#fff;padding:32px">
      <p style="font-size:12px;letter-spacing:.2em;color:#7a5c3e;margin:0 0 24px">EBONY FORTUNATOW</p>
      ${inner}
    </div></div>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid request.' });

  const error = validate(body);
  if (error) return res.status(400).json({ error });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_FROM_EMAIL || 'Ebony Fortunatow <onboarding@resend.dev>';
  const studio = process.env.STUDIO_EMAIL || 'studio@ebonyfortunatow.com';
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set for this deployment');
    return res.status(500).json({ error: 'Booking email is not configured yet (RESEND_API_KEY missing).' });
  }

  const b = {
    workshop: body.workshop.trim(),
    date: body.date,
    time: body.time.trim(),
    price: Number(body.price) || 0,
    name: body.name.trim(),
    email: body.email.trim(),
    phone: body.phone.trim(),
  };
  const when = `${longDate(b.date)}, ${b.time}`;

  const emails = [
    {
      from,
      to: [b.email],
      reply_to: studio,
      subject: `Booking received – ${b.workshop} – ${when}`,
      html: wrap(`
        <h2 style="font-weight:300;letter-spacing:.08em;color:#2a2520;margin:0 0 16px">You're booked in</h2>
        <p style="font-size:14px;color:#6b6059;line-height:1.7">Hi ${esc(b.name.split(' ')[0])}, thanks for booking. Here are your details:</p>
        ${detailsTable(b)}
        <p style="font-size:14px;color:#6b6059;line-height:1.7;margin-top:24px">All clay and tools are provided — just wear something you don't mind getting messy. Reply to this email if you have any questions.</p>
      `),
    },
    {
      from,
      to: [studio],
      reply_to: b.email,
      subject: `New booking – ${b.workshop} – ${when} – ${b.name}`,
      html: wrap(`
        <h2 style="font-weight:300;letter-spacing:.08em;color:#2a2520;margin:0 0 16px">New booking</h2>
        ${detailsTable(b)}
      `),
    },
  ];

  try {
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emails),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('Resend error', r.status, detail);
      return res.status(502).json({ error: 'We could not send your confirmation email. Please try again.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Resend request failed', err);
    return res.status(502).json({ error: 'We could not send your confirmation email. Please try again.' });
  }
};
