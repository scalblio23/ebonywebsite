// Studio admin: edit workshop availability (dates, times, seats) and view bookings.
(function () {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const $ = id => document.getElementById(id);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let server = null;   // last data from the server: { workshops, booked, bookings }
  let draft = null;    // editable copy of server.workshops
  let dirty = false;
  let active = null;   // workshop slug
  let month = new Date(today.getFullYear(), today.getMonth(), 1);
  let selected = null; // ISO date being edited
  let view = 'students'; // 'students' | 'availability'
  let showPast = false;
  let search = '';
  let movable = [];    // bookings shown on the Students view, indexed by data-move

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
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
  function shortDate(iso) {
    const d = fromIso(iso);
    return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  }
  function fmtClock(v) {
    const [h, m] = v.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
  }
  function isFuture(iso) {
    return fromIso(iso) > today;
  }
  function w() {
    return draft[active];
  }
  function seatsFor(iso) {
    const d = w().dates[iso];
    return d && Number.isInteger(d.seats) ? d.seats : w().seatLimit;
  }
  function bookedFor(iso, time) {
    return (server.booked[active] || {})[`${iso}|${time}`] || 0;
  }
  function bookedOnDate(iso) {
    return w().times.reduce((n, t) => n + bookedFor(iso, t), 0);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function show(view) {
    $('adm-loading').hidden = view !== 'loading';
    $('adm-login').hidden = view !== 'login';
    $('adm-app').hidden = view !== 'app';
    $('adm-user').hidden = view !== 'app';
  }

  function setDirty(v) {
    dirty = v;
    $('adm-savebar').hidden = !v;
    $('adm-save-status').textContent = 'You have unsaved changes';
    $('adm-save').disabled = false;
  }

  function appError(msg) {
    $('adm-app-error').textContent = msg || '';
    $('adm-app-error').hidden = !msg;
  }

  // ---------- rendering ----------
  function renderTabs() {
    $('adm-tabs').innerHTML = Object.entries(draft).map(([slug, x]) =>
      `<button type="button" class="adm-tab${slug === active ? ' active' : ''}" data-tab="${slug}">${esc(x.name)}</button>`
    ).join('');
  }

  function renderSettings() {
    const x = w();
    return `
      <section class="adm-card">
        <h2>Workshop settings</h2>
        <div class="adm-fields">
          <label>Price per person ($)<input type="number" min="0" step="1" data-field="price" value="${x.price}" /></label>
          <label>Seats per session<input type="number" min="1" step="1" data-field="seatLimit" value="${x.seatLimit}" /></label>
        </div>
        <h3>Session times</h3>
        <p class="adm-muted">The times people can choose from. Untick a time on a specific date to close just that session.</p>
        <ul class="adm-times">
          ${x.times.length ? x.times.map((t, i) => `
            <li><span>${esc(t)}</span><button type="button" class="adm-x" data-remove-time="${i}" aria-label="Remove ${esc(t)}">&times;</button></li>
          `).join('') : '<li class="adm-muted">No times yet — add one below.</li>'}
        </ul>
        <div class="adm-add-time">
          <label>Start<input type="time" id="adm-time-start" value="10:00" /></label>
          <label>End<input type="time" id="adm-time-end" value="12:00" /></label>
          <button type="button" class="btn-outline" data-add-time>Add time</button>
        </div>
      </section>
    `;
  }

  function renderCalendar() {
    const year = month.getFullYear();
    const m = month.getMonth();
    const firstDay = new Date(year, m, 1).getDay();
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const atStart = year === today.getFullYear() && m === today.getMonth();
    let cells = '';
    for (let i = 0; i < firstDay; i++) cells += `<div class="adm-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoDate(new Date(year, m, d));
      const open = !!w().dates[iso];
      const future = isFuture(iso);
      let cls = 'adm-cell';
      if (!future) cls += ' past';
      if (open) cls += ' open';
      if (iso === selected) cls += ' selected';
      const booked = open ? bookedOnDate(iso) : 0;
      cells += future || open
        ? `<button type="button" class="${cls}" data-date="${iso}">${d}${booked ? `<small>${booked}</small>` : ''}</button>`
        : `<div class="${cls}">${d}</div>`;
    }
    return `
      <section class="adm-card">
        <h2>Dates</h2>
        <p class="adm-muted">Click a date to open it for booking. Click an open date to edit or close it.</p>
        <div class="cal-header">
          <button type="button" class="cal-nav" data-month="-1" ${atStart ? 'disabled' : ''} aria-label="Previous month">&#8249;</button>
          <span class="cal-title">${MONTHS[m]} ${year}</span>
          <button type="button" class="cal-nav" data-month="1" aria-label="Next month">&#8250;</button>
        </div>
        <div class="adm-cal">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(n => `<div class="cal-day-name">${n}</div>`).join('')}
          ${cells}
        </div>
        <div class="adm-legend">
          <span><i class="adm-sw open"></i> Open</span>
          <span><i class="adm-sw"></i> Closed</span>
          <span><small class="adm-badge">3</small> Seats booked</span>
        </div>
        <div class="adm-bulk">
          <span class="adm-muted">This month:</span>
          <button type="button" class="adm-link" data-bulk="6">Open all Saturdays</button>
          <button type="button" class="adm-link" data-bulk="0">Open all Sundays</button>
          <button type="button" class="adm-link" data-bulk="close">Close all without bookings</button>
        </div>
      </section>
    `;
  }

  function renderDateEditor() {
    if (!selected || !w().dates[selected]) {
      return `
        <section class="adm-card adm-empty" id="adm-editor">
          <h2>Session details</h2>
          <p class="adm-muted">Select an open date on the calendar to change its times and seats, and to see who's booked.</p>
        </section>
      `;
    }
    const d = w().dates[selected];
    const seats = seatsFor(selected);
    const people = (server.bookings[active] || []).filter(b => b.date === selected);
    return `
      <section class="adm-card" id="adm-editor">
        <h2>${longDate(selected)}</h2>
        <div class="adm-fields">
          <label>Seats per session on this date
            <input type="number" min="0" step="1" data-date-seats placeholder="Default (${w().seatLimit})" value="${Number.isInteger(d.seats) ? d.seats : ''}" />
          </label>
        </div>
        <h3>Times open</h3>
        ${w().times.length ? `<ul class="adm-checks">
          ${w().times.map(t => {
            const booked = bookedFor(selected, t);
            return `<li>
              <label><input type="checkbox" data-date-time="${esc(t)}" ${d.times.includes(t) ? 'checked' : ''} /> ${esc(t)}</label>
              <span class="adm-count${booked >= seats ? ' full' : ''}">${booked} / ${seats} booked</span>
            </li>`;
          }).join('')}
        </ul>` : '<p class="adm-muted">Add a session time in Workshop settings first.</p>'}
        <h3>Bookings</h3>
        ${people.length ? `<ul class="adm-people">
          ${people.map(p => `<li>
            <strong>${esc(p.name)}</strong> <span class="adm-muted">${esc(p.time)}</span><br />
            <a href="mailto:${esc(p.email)}">${esc(p.email)}</a> · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>
            ${p.notes ? `<br /><span class="adm-note">${esc(p.notes)}</span>` : ''}
          </li>`).join('')}
        </ul>` : '<p class="adm-muted">No bookings yet.</p>'}
        <button type="button" class="btn-outline adm-danger" data-close-date>Close this date</button>
      </section>
    `;
  }

  function renderUpcoming() {
    const dates = Object.keys(w().dates).filter(isFuture).sort();
    const rows = [];
    for (const iso of dates) {
      const d = w().dates[iso];
      const seats = seatsFor(iso);
      const times = d.times.filter(t => w().times.includes(t));
      if (!times.length) {
        rows.push(`<tr data-date="${iso}"><td>${shortDate(iso)}</td><td class="adm-muted">No times open</td><td></td></tr>`);
      }
      for (const t of times) {
        const booked = bookedFor(iso, t);
        rows.push(`<tr data-date="${iso}" class="${iso === selected ? 'selected' : ''}">
          <td>${shortDate(iso)}</td><td>${esc(t)}</td>
          <td class="${booked >= seats ? 'adm-full' : ''}">${booked} / ${seats}${booked >= seats ? ' · Full' : ''}</td>
        </tr>`);
      }
    }
    return `
      <section class="adm-card adm-wide">
        <h2>Upcoming sessions</h2>
        ${rows.length ? `<div class="adm-table-wrap"><table class="adm-table">
          <thead><tr><th>Date</th><th>Time</th><th>Booked</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table></div>` : '<p class="adm-muted">No upcoming dates are open. Click dates on the calendar to open them.</p>'}
      </section>
    `;
  }

  // ---------- students view ----------
  function timeKey(label) {
    const m = /^(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(label || '');
    if (!m) return 0;
    return ((Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(m[2]);
  }

  function savedSeats(slug, iso) {
    const x = server.workshops[slug];
    const d = x && x.dates[iso];
    return d && Number.isInteger(d.seats) ? d.seats : (x ? x.seatLimit : 0);
  }

  function sessionList() {
    const map = new Map();
    const add = (slug, date, time) => {
      const key = `${slug}|${date}|${time}`;
      if (!map.has(key)) map.set(key, { slug, date, time, people: [] });
      return map.get(key);
    };
    // Open sessions (even with nobody booked yet)
    for (const [slug, x] of Object.entries(server.workshops)) {
      for (const [date, d] of Object.entries(x.dates)) {
        for (const t of d.times) if (x.times.includes(t)) add(slug, date, t);
      }
    }
    for (const [slug, list] of Object.entries(server.bookings)) {
      for (const b of list) add(slug, b.date, b.time).people.push(b);
    }
    return [...map.values()].sort((a, b) =>
      a.date.localeCompare(b.date) || timeKey(a.time) - timeKey(b.time) || a.slug.localeCompare(b.slug));
  }

  function renderStudents() {
    const q = search.trim().toLowerCase();
    const match = p => !q || [p.name, p.email, p.phone, p.notes].some(v => String(v || '').toLowerCase().includes(q));
    let sessions = sessionList().filter(s => showPast || fromIso(s.date) >= today);
    if (q) sessions = sessions.map(s => ({ ...s, people: s.people.filter(match) })).filter(s => s.people.length);
    const total = sessions.reduce((n, s) => n + s.people.length, 0);
    movable = [];

    const cards = sessions.map(s => {
      const x = server.workshops[s.slug];
      const seats = savedSeats(s.slug, s.date);
      const count = (server.booked[s.slug] || {})[`${s.date}|${s.time}`] || s.people.length;
      const full = count >= seats;
      const emails = [...new Set(s.people.map(p => p.email).filter(Boolean))].join(', ');
      return `
        <section class="adm-card adm-session">
          <div class="adm-session-head">
            <div>
              <h2>${esc(x ? x.name : s.slug)}</h2>
              <p class="adm-session-when">${longDate(s.date)} · ${esc(s.time)}</p>
            </div>
            <div class="adm-session-meta">
              <span class="adm-count${full ? ' full' : ''}">${count} / ${seats} booked${full ? ' · Full' : ''}</span>
              ${emails ? `<button type="button" class="adm-link" data-copy="${esc(emails)}">Copy emails</button>` : ''}
            </div>
          </div>
          ${s.people.length ? `<div class="adm-table-wrap"><table class="adm-table adm-students">
            <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Notes</th></tr></thead>
            <tbody>${s.people.map((p, i) => `<tr>
              <td class="adm-muted">${i + 1}</td>
              <td><button type="button" class="adm-student" data-move="${movable.push({ ...p, slug: s.slug }) - 1}" title="Reschedule ${esc(p.name)}">${esc(p.name)}</button></td>
              <td>${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}</td>
              <td>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</td>
              <td class="adm-notes">${esc(p.notes || '')}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<p class="adm-muted">Nobody booked yet.</p>'}
        </section>
      `;
    }).join('');

    return `
      <div class="adm-toolbar">
        <input type="search" id="adm-search" placeholder="Search name, email, phone or notes" value="${esc(search)}" />
        <label class="adm-check"><input type="checkbox" id="adm-past" ${showPast ? 'checked' : ''} /> Show past classes</label>
      </div>
      <p class="adm-muted adm-summary">${sessions.length} ${sessions.length === 1 ? 'class' : 'classes'} · ${total} ${total === 1 ? 'student' : 'students'}</p>
      <div class="adm-sessions">
        ${cards || `<section class="adm-card"><p class="adm-muted">${q ? 'No students match your search.' : 'No upcoming classes yet. Open dates in Availability.'}</p></section>`}
      </div>
    `;
  }

  function renderViews() {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('adm-title').textContent = view === 'students' ? 'Students' : 'Availability';
    $('adm-subtitle').textContent = view === 'students'
      ? 'Everyone booked into each class, soonest first. Click a name to reschedule them.'
      : 'Pick a workshop, set its times and seats, then click dates on the calendar to open or close them.';
    $('adm-tabs').hidden = view !== 'availability';
  }

  function render() {
    renderViews();
    if (view === 'students') {
      const hadFocus = document.activeElement && document.activeElement.id === 'adm-search';
      $('adm-panel').innerHTML = renderStudents();
      if (hadFocus) {
        const el = $('adm-search');
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
      return;
    }
    renderTabs();
    $('adm-panel').innerHTML = `<div class="adm-grid">
      ${renderSettings()}
      ${renderCalendar()}
      ${renderDateEditor()}
      ${renderUpcoming()}
    </div>`;
  }

  // ---------- actions ----------
  function openDate(iso) {
    if (!w().dates[iso]) {
      w().dates[iso] = { times: [...w().times], seats: null };
      setDirty(true);
    }
  }

  function closeDate(iso) {
    const booked = bookedOnDate(iso);
    if (booked && !confirm(`${longDate(iso)} has ${booked} booking${booked === 1 ? '' : 's'}. Close it anyway? Existing bookings are kept, but nobody else can book.`)) {
      return false;
    }
    delete w().dates[iso];
    setDirty(true);
    return true;
  }

  $('adm-panel').addEventListener('click', e => {
    const t = e.target.closest('button, tr[data-date]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.month) {
      month = new Date(month.getFullYear(), month.getMonth() + Number(ds.month), 1);
    } else if (ds.date) {
      if (t.tagName === 'BUTTON' && isFuture(ds.date)) openDate(ds.date);
      selected = ds.date;
      const d = fromIso(ds.date);
      month = new Date(d.getFullYear(), d.getMonth(), 1);
      render();
      // On narrow screens the editor sits below the calendar; bring it into view.
      if (window.innerWidth <= 900) $('adm-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    } else if (ds.bulk) {
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(month.getFullYear(), month.getMonth(), i);
        const iso = isoDate(date);
        if (!isFuture(iso)) continue;
        if (ds.bulk === 'close') {
          if (w().dates[iso] && !bookedOnDate(iso)) {
            delete w().dates[iso];
            setDirty(true);
          }
        } else if (date.getDay() === Number(ds.bulk)) {
          openDate(iso);
        }
      }
      if (selected && !w().dates[selected]) selected = null;
    } else if ('closeDate' in ds) {
      if (closeDate(selected)) selected = null;
    } else if ('addTime' in ds) {
      const start = $('adm-time-start').value;
      const end = $('adm-time-end').value;
      if (!start || !end) return;
      const label = `${fmtClock(start)} – ${fmtClock(end)}`;
      if (w().times.includes(label)) return;
      w().times.push(label);
      // New times open on every upcoming date; untick per date if needed.
      for (const [iso, d] of Object.entries(w().dates)) {
        if (isFuture(iso) && !d.times.includes(label)) d.times.push(label);
      }
      setDirty(true);
    } else if (ds.removeTime !== undefined) {
      const label = w().times[Number(ds.removeTime)];
      const booked = Object.keys(w().dates).filter(isFuture).reduce((n, iso) => n + bookedFor(iso, label), 0);
      if (!confirm(booked
        ? `${label} has ${booked} upcoming booking${booked === 1 ? '' : 's'}. Remove it anyway? Existing bookings are kept.`
        : `Remove ${label} from all dates?`)) return;
      w().times.splice(Number(ds.removeTime), 1);
      for (const d of Object.values(w().dates)) d.times = d.times.filter(x => x !== label);
      setDirty(true);
    } else {
      return;
    }
    render();
  });

  $('adm-panel').addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.field) {
      const v = Number(el.value);
      if (el.value !== '' && Number.isFinite(v) && v >= 0) {
        w()[el.dataset.field] = el.dataset.field === 'seatLimit' ? Math.max(1, Math.round(v)) : v;
        setDirty(true);
      }
    } else if ('dateSeats' in el.dataset) {
      w().dates[selected].seats = el.value === '' ? null : Math.max(0, Math.round(Number(el.value)));
      setDirty(true);
    }
  });

  $('adm-panel').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.field || 'dateSeats' in el.dataset) {
      render(); // refresh seat counts shown elsewhere
    } else if (el.dataset.dateTime) {
      const d = w().dates[selected];
      const t = el.dataset.dateTime;
      d.times = el.checked
        ? w().times.filter(x => x === t || d.times.includes(x))
        : d.times.filter(x => x !== t);
      setDirty(true);
      render();
    }
  });

  $('adm-views').addEventListener('click', e => {
    const t = e.target.closest('[data-view]');
    if (!t || t.dataset.view === view) return;
    view = t.dataset.view;
    render();
  });

  $('adm-panel').addEventListener('input', e => {
    if (e.target.id === 'adm-search') {
      search = e.target.value;
      render();
    }
  });

  $('adm-panel').addEventListener('change', e => {
    if (e.target.id === 'adm-past') {
      showPast = e.target.checked;
      render();
    }
  });

  $('adm-panel').addEventListener('click', async e => {
    const t = e.target.closest('[data-copy]');
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t.dataset.copy);
      t.textContent = 'Copied';
    } catch {
      prompt('Copy these emails:', t.dataset.copy);
    }
  });

  $('adm-tabs').addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    active = t.dataset.tab;
    selected = null;
    render();
  });

  $('adm-save').addEventListener('click', async () => {
    $('adm-save').disabled = true;
    $('adm-save-status').textContent = 'Saving…';
    try {
      const saved = await api('/api/admin/config', { method: 'PUT', body: JSON.stringify({ workshops: draft }) });
      server.workshops = saved.workshops;
      draft = structuredClone(saved.workshops);
      setDirty(false);
      appError('');
      render();
    } catch (err) {
      if (err.status === 401) return show('login');
      $('adm-save').disabled = false;
      $('adm-save-status').textContent = `Couldn't save: ${err.message}`;
    }
  });

  $('adm-discard').addEventListener('click', () => {
    draft = structuredClone(server.workshops);
    if (selected && !w().dates[selected]) selected = null;
    setDirty(false);
    render();
  });

  window.addEventListener('beforeunload', e => {
    if (dirty) e.preventDefault();
  });

  // ---------- reschedule ----------
  const move = { booking: null, done: false };

  function seatsLeft(slug, iso, time) {
    return savedSeats(slug, iso) - ((server.booked[slug] || {})[`${iso}|${time}`] || 0);
  }

  function openMove(booking) {
    if (dirty) {
      alert('Save or discard your availability changes before moving a student.');
      return;
    }
    move.booking = booking;
    move.done = false;
    const f = $('adm-move-form');
    f.workshop.innerHTML = Object.entries(server.workshops).map(([slug, x]) =>
      `<option value="${slug}">${esc(x.name)}</option>`).join('');
    f.workshop.value = booking.slug;
    f.otherDate.value = '';
    f.otherDate.min = isoDate(today);
    $('adm-move-from').textContent = `Currently in ${booking.workshop}, ${longDate(booking.date)} · ${booking.time}`;
    $('adm-move-name').textContent = `Reschedule ${booking.name}`;
    $('adm-move-error').hidden = true;
    $('adm-move-form').hidden = false;
    $('adm-move-done').hidden = true;
    fillDates();
    $('adm-move').showModal();
  }

  function fillDates() {
    const f = $('adm-move-form');
    const x = server.workshops[f.workshop.value];
    const dates = Object.keys(x.dates).filter(iso => fromIso(iso) >= today).sort();
    f.date.innerHTML = '<option value="">Choose a date</option>'
      + dates.map(iso => `<option value="${iso}">${shortDate(iso)}</option>`).join('')
      + '<option value="other">Another date…</option>';
    fillTimes();
  }

  function chosenDate() {
    const f = $('adm-move-form');
    return f.date.value === 'other' ? f.otherDate.value : f.date.value;
  }

  function fillTimes() {
    const f = $('adm-move-form');
    const slug = f.workshop.value;
    const x = server.workshops[slug];
    const iso = chosenDate();
    $('adm-move-other').hidden = f.date.value !== 'other';
    const open = x.dates[iso];
    const times = open ? open.times.filter(t => x.times.includes(t)) : x.times;
    const list = times.length ? times : x.times;
    f.time.innerHTML = iso
      ? '<option value="">Choose a time</option>' + list.map(t => {
        const left = seatsLeft(slug, iso, t);
        return `<option value="${esc(t)}">${esc(t)} · ${left > 0 ? `${left} ${left === 1 ? 'seat' : 'seats'} left` : 'Full'}</option>`;
      }).join('')
      : '<option value="">Choose a date first</option>';
    f.time.disabled = !iso;
    if (list.length === 1 && iso) f.time.value = list[0];
    updateMoveButton();
  }

  function updateMoveButton() {
    const f = $('adm-move-form');
    const iso = chosenDate();
    const ready = !!(iso && f.time.value);
    const btn = $('adm-move-confirm');
    btn.disabled = !ready;
    btn.textContent = 'Confirm';
    $('adm-move-summary').hidden = !ready;
    if (ready) {
      $('adm-move-summary').textContent =
        `Move ${move.booking.name} to ${server.workshops[f.workshop.value].name}, ${longDate(iso)} · ${f.time.value}?`;
    }
  }

  $('adm-move-form').addEventListener('change', e => {
    const name = e.target.name;
    if (name === 'workshop') fillDates();
    else if (name === 'date' || name === 'otherDate') fillTimes();
    else updateMoveButton();
  });

  $('adm-move-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (e.submitter && e.submitter.value === 'cancel') return $('adm-move').close();
    const f = e.target;
    const b = move.booking;
    const to = { workshop: f.workshop.value, date: chosenDate(), time: f.time.value };
    if (!to.date || !to.time) return;
    if (seatsLeft(to.workshop, to.date, to.time) <= 0
      && !confirm('That class is already full. Move them in anyway?')) return;
    const btn = $('adm-move-confirm');
    btn.disabled = true;
    btn.textContent = 'Moving…';
    $('adm-move-error').hidden = true;
    try {
      await api('/api/admin/reschedule', {
        method: 'POST',
        body: JSON.stringify({
          booking: { slug: b.slug, date: b.date, time: b.time, name: b.name, createdAt: b.createdAt },
          to,
        }),
      });
      const x = server.workshops[to.workshop];
      $('adm-move-done-text').textContent =
        `${b.name} is now booked into ${x.name} on ${longDate(to.date)} · ${to.time}.`;
      $('adm-move-form').hidden = true;
      $('adm-move-done').hidden = false;
      move.done = true;
      server = await api('/api/admin/config');
      draft = structuredClone(server.workshops);
      render();
    } catch (err) {
      if (err.status === 401) { $('adm-move').close(); return show('login'); }
      $('adm-move-error').textContent = err.message;
      $('adm-move-error').hidden = false;
      updateMoveButton();
    }
  });

  $('adm-move-close').addEventListener('click', () => $('adm-move').close());

  $('adm-panel').addEventListener('click', e => {
    const t = e.target.closest('[data-move]');
    if (t) openMove(movable[Number(t.dataset.move)]);
  });

  // ---------- auth ----------
  async function loadApp() {
    show('loading');
    try {
      server = await api('/api/admin/config');
      draft = structuredClone(server.workshops);
      if (!active || !draft[active]) active = Object.keys(draft)[0];
      setDirty(false);
      appError('');
      show('app');
      render();
    } catch (err) {
      if (err.status === 401) {
        show('login');
      } else {
        show('app');
        $('adm-tabs').innerHTML = '';
        $('adm-panel').innerHTML = '';
        appError(err.message);
      }
    }
  }

  $('adm-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    const errEl = $('adm-login-error');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.email.value, password: form.password.value }),
      });
      form.password.value = '';
      await loadApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log in';
    }
  });

  $('adm-logout').addEventListener('click', async () => {
    if (dirty && !confirm('You have unsaved changes. Log out anyway?')) return;
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setDirty(false);
    show('login');
  });

  loadApp();
})();
