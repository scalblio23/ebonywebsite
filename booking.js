// Calendly-style booking widget: date → time → details → book → payment (demo).
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
    const order = ['date', 'time', 'details'];
    const labels = ['Date', 'Time', 'Details'];
    const idx = state.step === 'done' ? 3 : order.indexOf(state.step);
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
      html += `<p class="bk-sub bk-empty">No dates are open for booking right now. Email <a href="mailto:studio@ebonyfortunatow.com">studio@ebonyfortunatow.com</a> to register your interest.</p>`;
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
          ${state.submitting ? 'Booking…' : 'Book Class'}
        </button>
      </form>
    `;
  }

  function renderDone() {
    return `
      <div class="bk-done">
        <p class="bk-heading">You're booked in</p>
        <p class="bk-sub">A confirmation has been sent to <strong>${esc(state.details.email)}</strong>.</p>
        ${summary()}
        <button type="button" class="btn-outline bk-again" data-restart>Book another spot</button>
      </div>
    `;
  }

  function renderLoading() {
    return state.loadError
      ? `<p class="bk-error" role="alert">${esc(state.loadError)}</p>
         <p class="bk-sub">Please email <a href="mailto:studio@ebonyfortunatow.com">studio@ebonyfortunatow.com</a> to book.</p>`
      : `<p class="bk-sub">Loading available dates…</p>`;
  }

  function render() {
    const body = {
      loading: renderLoading,
      date: renderDate,
      time: renderTime,
      details: renderDetails,
      done: renderDone,
    }[state.step]();
    root.innerHTML = steps() + `<div class="bk-body">${body}</div>`;
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
      load(false);
      openPayment();
    } catch (err) {
      state.submitting = false;
      state.error = err.message === 'Failed to fetch'
        ? 'Could not reach the booking server. Please try again.'
        : err.message;
      render();
    }
  }

  // Payment step — demo stand-in for the Whop checkout embed
  function openPayment() {
    const overlay = document.createElement('div');
    overlay.className = 'bk-modal-overlay';
    overlay.innerHTML = `
      <div class="bk-modal" role="dialog" aria-modal="true" aria-labelledby="bk-modal-title">
        <button type="button" class="bk-modal-close" aria-label="Close">&times;</button>
        <p class="bk-demo-tag">Demo checkout · Whop</p>
        <h3 id="bk-modal-title">Complete your payment</h3>
        <div class="bk-modal-order">
          <div><span>${esc(opts.name)}</span><span>$${Number(opts.price).toFixed(2)}</span></div>
          <div class="bk-modal-meta">${longDate(state.date)} · ${esc(state.time)}</div>
          <div class="bk-modal-total"><span>Total</span><span>$${Number(opts.price).toFixed(2)} AUD</span></div>
        </div>
        <form class="bk-form bk-pay-form">
          <label>Card number<input type="text" value="4242 4242 4242 4242" readonly /></label>
          <div class="bk-row">
            <label>Expiry<input type="text" value="12 / 30" readonly /></label>
            <label>CVC<input type="text" value="123" readonly /></label>
          </div>
          <button type="submit" class="btn-solid bk-submit">Pay $${Number(opts.price).toFixed(2)}</button>
          <p class="bk-demo-note">This is a demo. No payment will be taken.</p>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('bk-modal-open');

    const finish = () => {
      overlay.remove();
      document.body.classList.remove('bk-modal-open');
      document.removeEventListener('keydown', onKey);
      state.step = 'done';
      render();
    };
    const onKey = e => { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', onKey);

    overlay.querySelector('.bk-modal-close').addEventListener('click', finish);
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(); });
    overlay.querySelector('.bk-pay-form').addEventListener('submit', e => {
      e.preventDefault();
      const modal = overlay.querySelector('.bk-modal');
      modal.innerHTML = `
        <p class="bk-demo-tag">Demo checkout · Whop</p>
        <h3>Payment successful</h3>
        <p class="bk-sub">Thanks ${esc(state.details.name.split(' ')[0])}, your spot is confirmed.</p>
        <button type="button" class="btn-solid bk-submit">Done</button>
      `;
      modal.querySelector('button').addEventListener('click', finish);
    });
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
      state.step = t.dataset.back;
      state.error = '';
      render();
    } else if ('restart' in t.dataset) {
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

  render();
  load(true).then(() => {
    if (!state.loadError) state.step = 'date';
    render();
  });
}
