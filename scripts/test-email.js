// Local test: sends a booking confirmation and/or enquiry notification.
//
//   cp .env.example .env   # then add your RESEND_API_KEY
//   npm run test:email -- booking you@example.com
//   npm run test:email -- enquiry you@example.com
//   npm run test:email -- all you@example.com
//
// With no address, emails go to Resend's test inbox (delivered@resend.dev).

import { sendBookingConfirmation, sendEnquiryNotification } from '../api/_lib/email.js';

const [type = 'all', to = 'delivered@resend.dev'] = process.argv.slice(2);

async function run() {
  if (type === 'booking' || type === 'all') {
    const data = await sendBookingConfirmation({
      to,
      name: 'Test Customer',
      workshop: 'Beginners Hand-building',
      date: 'Sat Nov 14 2026',
    });
    console.log('Booking confirmation sent:', data.id);
  }

  if (type === 'enquiry' || type === 'all') {
    const data = await sendEnquiryNotification({
      to,
      name: 'Test Customer',
      email: 'test.customer@example.com',
      phone: '0400 000 000',
      workshop: 'Build Your Own Dinner Set',
      message: 'Hi, is there space for two people on the next dinner set workshop?',
    });
    console.log('Enquiry notification sent:', data.id);
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
