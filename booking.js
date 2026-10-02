// Calendly-style booking widget: date → time → Whop checkout (embedded) → thank-you page,
// where the customer adds their name, email and phone.
// Dates, times and seats come from /api/availability (set in admin.html).
// Usage:
//   initBooking({ containerId: 'booking', workshop: 'beginners' });
function initBooking(opts) {
  const root = document.getElementById(opts.containerId);
  if (!root) return;

  const endpoint = opts.endpoint || '/api/book';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // date -> [{ time, left }], filled from the API
  let sessions = new Map();

  const state = {
    step: 'loading',
    loadError: '',
    month: new Date(today.getFullYear(), today.getMonth(), 1),
    date: null,
    time: null,
    error: '',
  };

  async function load(moveToFirst) {
    try {
      const res = await fetch(`/api/availability?workshop=${encodeURIComponent(opts.workshop)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load availability.');
      opts.name = data.name;
      opts.price = data.price;
      // Keep the price text elsewhere on the page in step with the admin price.
      document.querySelectorAll('[data-price]').forEach(el => {
        el.textContent = `$${Number(data.price) % 1 ? Number(data.price).toFixed(2) : data.price}`;
      });
      sessions = new Map(data.dates.map(d => [d.date, d.slots]));
      const first = data.dates.find(d => d.slots.some(s => s.left > 0));
      if (moveToFirst && first) {
        const f = fromIso(first.date);
        state.month = new Date(f.getFullYear(), f.getMonth(), 1);
      }
      state.loadError = '';
    } catch (err) {
      state.loadError = err.message === 'Failed to fetch' ? 'Could not load availability.' : err.message;
    }
  }

  function seatsLeft(iso) {
    return (sessions.get(iso) || []).reduce((n, s) => n + s.left, 0);
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fromIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function longDate(iso) {
    const d = fromIso(iso);
    return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Meta Pixel events (pixel.js). Purchase is sent from the thank-you page.
  function track(event, params, eventID) {
    if (typeof window.fbq !== 'function') return;
    window.fbq('track', event, {
      content_name: opts.name,
      content_ids: [opts.workshop],
      content_type: 'product',
      value: Number(opts.price) || 0,
      currency: 'AUD',
      ...params,
    }, eventID ? { eventID } : undefined);
  }


  function steps() {
    const order = ['date', 'time', 'pay'];
    const labels = ['Date', 'Time', 'Payment'];
    const idx = order.indexOf(state.step);
    return `<ol class="bk-steps">${labels.map((l, i) =>
      `<li class="${i < idx ? 'done' : i === idx ? 'active' : ''}">${i + 1}. ${l}</li>`).join('')}</ol>`;
  }

  function renderDate() {
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const atStart = year === today.getFullYear() && month === today.getMonth();

    let html = `
      <p class="bk-heading">Select a date</p>
      <div class="cal-header">
        <button type="button" class="cal-nav" data-nav="-1" ${atStart ? 'disabled' : ''} aria-label="Previous month">&#8249;</button>
        <span class="cal-title">${MONTHS[month]} ${year}</span>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Next month">&#8250;</button>
      </div>
      <div class="cal-grid">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(n => `<div class="cal-day-name">${n}</div>`).join('')}
    `;
    for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const iso = isoDate(date);
      const clickable = date > today && seatsLeft(iso) > 0;
      let cls = 'cal-cell';
      if (date <= today) cls += ' past';
      else if (iso === state.date) cls += ' selected';
      else if (clickable) cls += ' available';
      else if (sessions.has(iso)) cls += ' full';
      else cls += ' unavailable';
      html += clickable
        ? `<button type="button" class="${cls}" data-date="${iso}">${d}</button>`
        : `<div class="${cls}">${d}</div>`;
    }
    html += `</div><p class="bk-legend"><span class="bk-dot"></span> Available</p>`;
    if (!sessions.size) {
      html += `<p class="bk-sub bk-empty">No dates are open for booking right now. Email <a href="mailto:ebonyfortunatow@gmail.com">ebonyfortunatow@gmail.com</a> to register your interest.</p>`;
    }
    return html;
  }

  function renderTime() {
    return `
      <button type="button" class="bk-back" data-back="date">&#8249; Back</button>
      <p class="bk-heading">Select a time</p>
      <p class="bk-sub">${longDate(state.date)}</p>
      ${state.error ? `<p class="bk-error bk-error-top" role="alert">${esc(state.error)}</p>` : ''}
      <div class="bk-times">
        ${(sessions.get(state.date) || []).map(s => s.left > 0
          ? `<button type="button" class="bk-time${s.time === state.time ? ' selected' : ''}" data-time="${esc(s.time)}">${esc(s.time)}<span>${s.left} ${s.left === 1 ? 'spot' : 'spots'} left</span></button>`
          : `<div class="bk-time full">${esc(s.time)}<span>Full</span></div>`).join('')}
      </div>
    `;
  }

  function summary() {
    return `
      <div class="bk-summary">
        <div><span>Workshop</span><p>${esc(opts.name)}</p></div>
        <div><span>Date</span><p>${longDate(state.date)}</p></div>
        <div><span>Time</span><p>${esc(state.time)}</p></div>
        <div><span>Price</span><p>$${opts.price} per person</p></div>
      </div>
    `;
  }

  function renderPay() {
    const c = state.checkout;
    if (!c) {
      return `
        <p class="bk-heading">Payment</p>
        ${summary()}
        <p class="bk-sub">Preparing secure checkout…</p>`;
    }
    return `
      <button type="button" class="bk-back" data-back="time">&#8249; Change time</button>
      <p class="bk-heading">Payment</p>
      ${summary()}
      <div class="bk-whop" id="bk-whop"
        data-whop-checkout-plan-id="${esc(c.planId)}"
        data-whop-checkout-session="${esc(c.sessionId)}"
        data-whop-checkout-return-url="${esc(c.returnUrl)}"
        data-whop-checkout-theme="light"
        data-whop-checkout-prefill-address-country="AU"></div>
      <p class="bk-secure">Your spot is held for 30 minutes while you pay.${c.purchaseUrl
        ? ` Checkout not showing? <a href="${esc(c.purchaseUrl)}">Pay on Whop's secure page</a>.` : ''}</p>
    `;
  }

  // Whop's loader turns #bk-whop into the embedded checkout. Re-run it for each new checkout.
  function mountWhop() {
    const old = document.getElementById('whop-checkout-loader');
    if (old) old.remove();
    const s = document.createElement('script');
    s.id = 'whop-checkout-loader';
    s.async = true;
    s.src = 'https://js.whop.com/static/checkout/loader.js';
    document.body.appendChild(s);
  }

  // Poll until the Whop webhook has confirmed the payment.
  let pollId = 0;
  async function waitForPayment(id) {
    const mine = ++pollId;
    for (let i = 0; i < 600 && mine === pollId; i++) {
      await new Promise(r => setTimeout(r, 3000));
      if (mine !== pollId || state.step !== 'pay') return;
      try {
        const res = await fetch(`/api/booking-status?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.status === 'paid') {
          location.href = `thankyou.html?booking=${encodeURIComponent(id)}`;
          return;
        }
      } catch { /* keep waiting */ }
    }
  }

  // Older return links (?booking=<id> on a workshop page) go to the thank-you page.
  function showReturn(id) {
    location.replace(`thankyou.html?booking=${encodeURIComponent(id)}`);
    return true;
  }

  function renderLoading() {
    return state.loadError
      ? `<p class="bk-error" role="alert">${esc(state.loadError)}</p>
         <p class="bk-sub">Please email <a href="mailto:ebonyfortunatow@gmail.com">ebonyfortunatow@gmail.com</a> to book.</p>`
      : `<p class="bk-sub">Loading available dates…</p>`;
  }

  function render() {
    const body = {
      loading: renderLoading,
      date: renderDate,
      time: renderTime,
      pay: renderPay,
    }[state.step]();
    root.innerHTML = steps() + `<div class="bk-body">${body}</div>`;
    if (state.step === 'pay' && state.checkout) mountWhop();
  }

  // Picking a time goes straight to payment: hold the seat and create the checkout.
  async function startCheckout() {
    state.checkout = null;
    state.error = '';
    state.step = 'pay';
    render();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workshop: opts.workshop, date: state.date, time: state.time }),
      });
      const data = await res.json().catch(() => ({}));
      if (state.step !== 'pay') return; // customer went back while we were waiting
      if (!res.ok) {
        if (res.status === 409) await load(false);
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }
      state.checkout = data;
      render();
      track('InitiateCheckout', { num_items: 1 }, `${data.bookingId}-checkout`);
      waitForPayment(data.bookingId);
    } catch (err) {
      state.step = 'time';
      state.time = null;
      state.error = err.message === 'Failed to fetch'
        ? 'Could not reach the booking server. Please try again.'
        : err.message;
      render();
    }
  }

  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.dataset.nav) {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + Number(t.dataset.nav), 1);
      render();
    } else if (t.dataset.date) {
      state.date = t.dataset.date;
      state.time = null;
      state.error = '';
      state.step = 'time';
      render();
    } else if (t.dataset.time) {
      state.time = t.dataset.time;
      startCheckout();
    } else if (t.dataset.back) {
      pollId++;
      if (state.checkout) {
        // Free the seat held for the abandoned checkout.
        fetch('/api/release-hold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: state.checkout.bookingId }),
        }).then(() => load(false)).then(() => { if (state.step === 'time') render(); }).catch(() => {});
      }
      state.checkout = null;
      state.step = t.dataset.back;
      state.error = '';
      render();
    }
  });

  const bookingId = new URLSearchParams(location.search).get('booking');

  render();
  load(true).then(async () => {
    if (!state.loadError) track('ViewContent');
    if (bookingId && showReturn(bookingId)) return;
    if (!state.loadError) state.step = 'date';
    render();
  });
}
