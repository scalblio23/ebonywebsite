// Test endpoint for checking Resend works on Vercel.
//
//   curl -X POST "https://<your-site>.vercel.app/api/test-email?type=booking"
//   curl -X POST "https://<your-site>.vercel.app/api/test-email?type=enquiry"
//
// Emails always go to Resend's test inbox (delivered@resend.dev), so this
// endpoint can't be used to email arbitrary people. Check the result in the
// Resend dashboard → Emails. Delete this file once you're happy.

import { sendBookingConfirmation, sendEnquiryNotification } from './_lib/email.js';

const TEST_INBOX = 'delivered@resend.dev';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }

  const type = req.query.type || 'booking';

  try {
    let data;
    if (type === 'booking') {
      data = await sendBookingConfirmation({
        to: TEST_INBOX,
        name: 'Test Customer',
        workshop: 'Beginners Hand-building',
        date: 'Sat Nov 14 2026',
      });
    } else if (type === 'enquiry') {
      data = await sendEnquiryNotification({
        to: TEST_INBOX,
        name: 'Test Customer',
        email: 'test.customer@example.com',
        phone: '0400 000 000',
        workshop: 'Build Your Own Dinner Set',
        message: 'Hi, is there space for two people on the next dinner set workshop?',
      });
    } else {
      return res.status(400).json({ ok: false, error: 'type must be "booking" or "enquiry"' });
    }

    return res.status(200).json({ ok: true, type, id: data?.id });
  } catch (err) {
    console.error('test-email failed:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
