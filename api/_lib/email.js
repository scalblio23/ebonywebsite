// Server-side email helpers built on Resend.
//
// This file lives under /api/_lib so Vercel bundles it into serverless
// functions only: the leading underscore stops it becoming an endpoint,
// and nothing under /api is served to the browser as a static file.
// Never import it from client-side scripts (main.js, calendar.js, etc.).

import { Resend } from 'resend';

// TODO: replace YOURDOMAIN.com with your verified Resend sending domain,
// or set EMAIL_FROM in Vercel to override without a code change.
export const DEFAULT_FROM = 'Ceramics Class <bookings@YOURDOMAIN.com>';

// Where enquiry notifications are delivered (the studio inbox).
export const DEFAULT_NOTIFY_TO = 'studio@ebonyfortunatow.com';

let client;

function getClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set. Add it to your Vercel environment variables (or .env locally).');
  }
  if (!client) client = new Resend(apiKey);
  return client;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send an email via Resend.
 * Returns the Resend response data ({ id }) or throws on failure.
 */
export async function sendEmail({ to, subject, html, text, replyTo, from }) {
  if (!to || !subject || (!html && !text)) {
    throw new Error('sendEmail requires "to", "subject" and "html" or "text".');
  }

  const { data, error } = await getClient().emails.send({
    from: from || process.env.EMAIL_FROM || DEFAULT_FROM,
    to,
    subject,
    html,
    text,
    replyTo,
  });

  if (error) {
    throw new Error(`Resend error (${error.name}): ${error.message}`);
  }
  return data;
}

/**
 * Booking confirmation sent to the customer.
 */
export async function sendBookingConfirmation({ to, name, workshop, date }) {
  const subject = `Booking confirmed – ${workshop}`;
  const text = [
    `Hi ${name},`,
    '',
    `Thanks for booking ${workshop} on ${date}. We can't wait to see you in the studio.`,
    '',
    'If you have any questions, just reply to this email.',
    '',
    'Ebony',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Thanks for booking <strong>${escapeHtml(workshop)}</strong> on <strong>${escapeHtml(date)}</strong>. We can't wait to see you in the studio.</p>
    <p>If you have any questions, just reply to this email.</p>
    <p>Ebony</p>
  `;

  return sendEmail({
    to,
    subject,
    html,
    text,
    replyTo: process.env.ENQUIRY_NOTIFY_TO || DEFAULT_NOTIFY_TO,
  });
}

/**
 * Notification sent to the studio when someone submits an enquiry.
 * Reply-To is set to the enquirer so the studio can reply directly.
 */
export async function sendEnquiryNotification({ name, email, phone, message, workshop, to }) {
  const subject = `New enquiry from ${name}${workshop ? ` – ${workshop}` : ''}`;
  const rows = [
    ['Name', name],
    ['Email', email],
    ['Phone', phone],
    ['Workshop', workshop],
  ].filter(([, v]) => v);

  const text = [
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    message || '',
  ].join('\n');
  const html = `
    <h2>New enquiry</h2>
    <table cellpadding="4">
      ${rows.map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${escapeHtml(v)}</td></tr>`).join('')}
    </table>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
  `;

  return sendEmail({
    to: to || process.env.ENQUIRY_NOTIFY_TO || DEFAULT_NOTIFY_TO,
    subject,
    html,
    text,
    replyTo: email,
  });
}
