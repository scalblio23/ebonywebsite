// Thank-you page: shows the booking (/thankyou?booking=<id>), waits for the
// payment to be confirmed, then offers Google / Outlook / Apple calendar links.
(function () {
  const root = document.getElementById('thankyou');
  if (!root) return;

  const LOCATION = '2 Ann St, Stepney SA 5069';
  const TIME_ZONE = 'Australia/Adelaide';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const id = new URLSearchParams(location.search).get('booking') || '';

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

  // --- Calendar event --------------------------------------------------------

  // "10:00am – 12:00pm" -> [[10, 0], [12, 0]]; null if it can't be read.
  function parseTimes(text) {
    const found = [...String(text).matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi)].map(m => {
      let h = Number(m[1]) % 12;
      if (m[3].toLowerCase() === 'pm') h += 12;
      return [h, Number(m[2] || 0)];
    });
    return found.length >= 2 ? found.slice(0, 2) : null;
  }

  // The UTC instant of a wall-clock time in Adelaide (handles daylight saving).
  function adelaideToUtc(iso, h, min) {
    const [y, m, d] = iso.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, h, min);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(new Date(guess)).reduce((o, p) => (o[p.type] = Number(p.value), o), {});
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    return new Date(guess - (shown - guess));
  }

  function stamp(date) { // 20261005T003000Z
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function buildEvent(b) {
    const times = parseTimes(b.time);
    const weekly = b.slug === '6-week';
    const ev = {
      title: `${b.workshop} – Ebony Fortunatow Studio`,
      details: `Your ${b.workshop} workshop at Ebony Fortunatow Studio.${weekly ? ' Runs weekly for 6 weeks.' : ''}\n\nAll clay and tools are provided — just wear something you don't mind getting messy.\n\nQuestions? Email ebonyfortunatow@gmail.com`,
      location: LOCATION,
      recur: weekly ? 'RRULE:FREQ=WEEKLY;COUNT=6' : '',
    };
    if (times) {
      ev.start = adelaideToUtc(b.date, times[0][0], times[0][1]);
      ev.end = adelaideToUtc(b.date, times[1][0], times[1][1]);
    } else {
      // Unknown time format: fall back to an all-day event.
      ev.allDay = b.date.replace(/-/g, '');
      const next = new Date(`${b.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      ev.allDayEnd = next.toISOString().slice(0, 10).replace(/-/g, '');
    }
    return ev;
  }

  function googleUrl(ev) {
    const q = new URLSearchParams({
      action: 'TEMPLATE',
      text: ev.title,
      dates: ev.allDay ? `${ev.allDay}/${ev.allDayEnd}` : `${stamp(ev.start)}/${stamp(ev.end)}`,
      details: ev.details,
      location: ev.location,
      ctz: TIME_ZONE,
    });
    if (ev.recur) q.set('recur', ev.recur);
    return `https://calendar.google.com/calendar/render?${q}`;
  }

  function outlookUrl(ev) {
    const q = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: ev.title,
      body: ev.details,
      location: ev.location,
    });
    if (ev.allDay) {
      q.set('startdt', `${ev.allDay.slice(0, 4)}-${ev.allDay.slice(4, 6)}-${ev.allDay.slice(6)}`);
      q.set('allday', 'true');
    } else {
      q.set('startdt', ev.start.toISOString());
      q.set('enddt', ev.end.toISOString());
    }
    return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
  }

  function icsUrl(ev) {
    const text = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ebony Fortunatow//Bookings//EN', 'BEGIN:VEVENT',
      `UID:${id}@ebonyfortunatow.com`,
      `DTSTAMP:${stamp(new Date())}`,
      ev.allDay ? `DTSTART;VALUE=DATE:${ev.allDay}` : `DTSTART:${stamp(ev.start)}`,
      ev.allDay ? `DTEND;VALUE=DATE:${ev.allDayEnd}` : `DTEND:${stamp(ev.end)}`,
      `SUMMARY:${text(ev.title)}`,
      `DESCRIPTION:${text(ev.details)}`,
      `LOCATION:${text(ev.location)}`,
      ...(ev.recur ? [ev.recur] : []),
      'END:VEVENT', 'END:VCALENDAR',
    ];
    return URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  }

  // --- Meta Pixel Purchase (once per booking) --------------------------------

  function trackPurchase(b) {
    if (typeof window.fbq !== 'function') return;
    const key = `fbq-purchase-${id}`;
    try { if (localStorage.getItem(key)) return; } catch { /* storage blocked */ }
    window.fbq('track', 'Purchase', {
      content_name: b.workshop,
      content_ids: [b.slug],
      content_type: 'product',
      value: Number(b.price) || 0,
      currency: 'AUD',
      num_items: 1,
    }, { eventID: id });
    try { localStorage.setItem(key, '1'); } catch { /* storage blocked */ }
  }

  // --- Rendering -------------------------------------------------------------

  function summary(b) {
    return `
      <div class="bk-summary ty-summary">
        <div><span>Workshop</span><p>${esc(b.workshop)}</p></div>
        <div><span>Date</span><p>${longDate(b.date)}${b.slug === '6-week' ? ' (weekly for 6 weeks)' : ''}</p></div>
        <div><span>Time</span><p>${esc(b.time)}</p></div>
        <div><span>Location</span><p>${esc(LOCATION)}</p></div>
        <div><span>Name</span><p>${esc(b.name || '')}</p></div>
        <div><span>Paid</span><p>$${Number(b.price).toFixed(2)}</p></div>
      </div>`;
  }

  function renderPaid(b) {
    const ev = buildEvent(b);
    const slugFile = String(b.slug || 'workshop').replace(/[^a-z0-9-]/gi, '');
    root.innerHTML = `
      <p class="ty-label">BOOKING CONFIRMED</p>
      <h1>Thank you${b.name ? `, ${esc(b.name.split(' ')[0])}` : ''}</h1>
      <p class="ty-lead">You're booked in. A confirmation email is on its way to <strong>${esc(b.email)}</strong>.</p>
      ${summary(b)}
      <p class="ty-cal-label">Add to your calendar</p>
      <div class="ty-actions">
        <a class="btn-solid" href="${esc(googleUrl(ev))}" target="_blank" rel="noopener">Google Calendar</a>
        <a class="btn-outline" href="${esc(outlookUrl(ev))}" target="_blank" rel="noopener">Outlook</a>
      </div>
      <p class="ty-ics"><a href="${icsUrl(ev)}" download="ebony-fortunatow-${slugFile}.ics">Apple Calendar or Outlook desktop (.ics file)</a></p>
      <p class="ty-note">All clay and tools are provided — just wear something you don't mind getting messy.
        Questions? Email <a href="mailto:ebonyfortunatow@gmail.com">ebonyfortunatow@gmail.com</a>.</p>
      <a class="ty-back" href="workshops.html">&#8249; Back to workshops</a>`;
    trackPurchase(b);
  }

  function renderPending(b) {
    root.innerHTML = `
      <p class="ty-label">ALMOST THERE</p>
      <h1>Confirming your payment…</h1>
      <p class="ty-lead">This usually takes a few seconds. Please keep this page open.</p>
      ${summary(b)}`;
  }

  function renderError(msg) {
    root.innerHTML = `
      <h1>We couldn't find that booking</h1>
      <p class="ty-lead">${esc(msg)} If you've paid, your confirmation email has your booking details.
        Questions? Email <a href="mailto:ebonyfortunatow@gmail.com">ebonyfortunatow@gmail.com</a>.</p>
      <a class="btn-outline" href="workshops.html">View workshops</a>`;
  }

  async function run() {
    if (!/^[a-f0-9]{32}$/.test(id)) return renderError('This link is missing its booking reference.');
    for (let i = 0; i < 200; i++) { // ~10 minutes
      try {
        const res = await fetch(`/api/booking-status?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404 || res.status === 400) return renderError('This booking link has expired or is not valid.');
        if (res.ok) {
          if (data.status === 'paid') return renderPaid(data);
          renderPending(data);
        }
      } catch { /* network blip: keep trying */ }
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  run();
})();
