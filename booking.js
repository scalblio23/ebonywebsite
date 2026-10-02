// Calendly-style booking widget: date → time → details → Whop checkout (embedded) → confirmed.
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
    details: { name: '', email: '', phone: '' },
    error: '',
    submitting: false,
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

  function steps() {
    const order = ['date', 'time', 'details', 'pay'];
    const labels = ['Date', 'Time', 'Details', 'Payment'];
    const idx = state.step === 'done' ? 4 : order.indexOf(state.step);
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

  function renderDetails() {
    const d = state.details;
    return `
      <button type="button" class="bk-back" data-back="time">&#8249; Back</button>
      <p class="bk-heading">Your details</p>
      ${summary()}
      <form class="bk-form" novalidate>
        <label>Full name<input name="name" type="text" autocomplete="name" required value="${esc(d.name)}" /></label>
        <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(d.email)}" /></label>
        <label>Phone<input name="phone" type="tel" autocomplete="tel" required value="${esc(d.phone)}" /></label>
        ${state.error ? `<p class="bk-error" role="alert">${esc(state.error)}</p>` : ''}
        <button type="submit" class="btn-solid bk-submit" ${state.submitting ? 'disabled' : ''}>
          ${state.submitting ? 'Please wait…' : 'Continue to payment'}
        </button>
      </form>
    `;
  }

  function renderPay() {
    const c = state.checkout;
    return `
      <button type="button" class="bk-back" data-back="details">&#8249; Back</button>
      <p class="bk-heading">Payment</p>
      ${summary()}
      <div class="bk-whop" id="bk-whop"
        data-whop-checkout-plan-id="${esc(c.planId)}"
        data-whop-checkout-session="${esc(c.sessionId)}"
        data-whop-checkout-return-url="${esc(c.returnUrl)}"
        data-whop-checkout-theme="light"
        data-whop-checkout-prefill-email="${esc(state.details.email)}"
        data-whop-checkout-prefill-name="${esc(state.details.name)}"
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
      if (mine !== pollId || !['pay', 'done'].includes(state.step)) return;
      try {
        const res = await fetch(`/api/booking-status?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.status === 'paid') {
          state.paymentStatus = 'paid';
          state.step = 'done';
          render();
          load(false);
          return;
        }
      } catch { /* keep waiting */ }
    }
  }

  function renderDone() {
    const paid = state.paymentStatus === 'paid';
    return `
      <div class="bk-done">
        <p class="bk-heading">${paid ? "You're booked in" : 'Confirming your payment…'}</p>
        <p class="bk-sub">${paid
          ? `Payment received. A confirmation has been sent to <strong>${esc(state.details.email)}</strong>.`
          : `This usually takes a few seconds. Your confirmation email will go to <strong>${esc(state.details.email)}</strong>.`}</p>
        ${summary()}
        <button type="button" class="btn-outline bk-again" data-restart>Book another spot</button>
      </div>
    `;
  }

  // Customer is back from Whop checkout: show the booking and wait for the payment webhook.
  async function showReturn(id) {
    try {
      const res = await fetch(`/api/booking-status?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return false;
      opts.name = data.workshop;
      opts.price = data.price;
      state.date = data.date;
      state.time = data.time;
      state.details.email = data.email;
      state.paymentStatus = data.status;
      state.step = 'done';
      render();
      if (data.status !== 'paid') waitForPayment(id);
      return true;
    } catch {
      return false;
    }
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
      details: renderDetails,
      pay: renderPay,
      done: renderDone,
    }[state.step]();
    root.innerHTML = steps() + `<div class="bk-body">${body}</div>`;
    if (state.step === 'pay') mountWhop();
  }

  function validate(d) {
    if (!d.name.trim()) return 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'Please enter a valid email address.';
    if (d.phone.replace(/\D/g, '').length < 8) return 'Please enter a valid phone number.';
    return '';
  }

  async function submit(form) {
    const fd = new FormData(form);
    state.details = {
      name: fd.get('name') || '',
      email: fd.get('email') || '',
      phone: fd.get('phone') || '',
    };
    state.error = validate(state.details);
    if (state.error) return render();

    state.submitting = true;
    render();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workshop: opts.workshop,
          date: state.date,
          time: state.time,
          name: state.details.name.trim(),
          email: state.details.email.trim(),
          phone: state.details.phone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          await load(false);
          state.step = 'time';
          state.time = null;
        }
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }
      state.submitting = false;
      state.checkout = data;
      state.step = 'pay';
      render();
      waitForPayment(data.bookingId);
    } catch (err) {
      state.submitting = false;
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
      state.step = 'details';
      state.error = '';
      render();
    } else if (t.dataset.back) {
      pollId++;
      state.step = t.dataset.back;
      state.error = '';
      render();
    } else if ('restart' in t.dataset) {
      if (bookingId) history.replaceState(null, '', location.pathname + '#book');
      state.step = 'date';
      state.date = null;
      state.time = null;
      render();
    }
  });

  root.addEventListener('submit', e => {
    e.preventDefault();
    submit(e.target);
  });

  const bookingId = new URLSearchParams(location.search).get('booking');

  render();
  load(true).then(async () => {
    if (bookingId && await showReturn(bookingId)) return;
    if (!state.loadError) state.step = 'date';
    render();
  });
}
