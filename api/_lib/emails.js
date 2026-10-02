// Booking emails sent via Resend: confirmation to the customer + notification to the studio.
//
// Environment variables:
//   RESEND_API_KEY      (required) Resend API key
//   BOOKING_FROM_EMAIL  (optional) verified sender, e.g. "Ebony Fortunatow <bookings@ebonyfortunatow.com>".
//                       Defaults to Resend's test sender, which only delivers to your Resend account email.
//   STUDIO_EMAIL        (optional) where studio notifications go; defaults to ebonyfortunatow@gmail.com

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

function detailsTable(b) {
  const rows = [
    ['Workshop', b.workshop],
    ['Date', longDate(b.date)],
    ['Time', b.time],
    ['Paid', b.price ? `$${Number(b.price).toFixed(2)}` : ''],
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

// b: { workshop, date, time, price, name, email, phone }; studioNote is added to the studio email only.
async function sendBookingEmails(b, studioNote) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set for this deployment');
  const from = process.env.BOOKING_FROM_EMAIL || 'Ebony Fortunatow <onboarding@resend.dev>';
  const studio = process.env.STUDIO_EMAIL || 'ebonyfortunatow@gmail.com';
  const when = `${longDate(b.date)}, ${b.time}`;

  const emails = [
    {
      from,
      to: [b.email],
      reply_to: studio,
      subject: `Booking confirmed – ${b.workshop} – ${when}`,
      html: wrap(`
        <h2 style="font-weight:300;letter-spacing:.08em;color:#2a2520;margin:0 0 16px">You're booked in</h2>
        <p style="font-size:14px;color:#6b6059;line-height:1.7">Hi ${esc(b.name.split(' ')[0])}, thanks for booking — your payment has been received. Here are your details:</p>
        ${detailsTable(b)}
        <p style="font-size:14px;color:#6b6059;line-height:1.7;margin-top:24px">All clay and tools are provided — just wear something you don't mind getting messy. Reply to this email if you have any questions.</p>
      `),
    },
    {
      from,
      to: [studio],
      reply_to: b.email,
      subject: `New paid booking – ${b.workshop} – ${when} – ${b.name}`,
      html: wrap(`
        <h2 style="font-weight:300;letter-spacing:.08em;color:#2a2520;margin:0 0 16px">New paid booking</h2>
        ${studioNote ? `<p style="font-size:14px;color:#a33a2a;line-height:1.7">${esc(studioNote)}</p>` : ''}
        ${detailsTable(b)}
      `),
    },
  ];

  const r = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(emails),
  });
  if (!r.ok) throw new Error(`Resend error ${r.status}: ${await r.text()}`);
}

module.exports = { sendBookingEmails };
