// Booking widget: 1) choose a date, 2) choose number of people, 3) send request.
// Usage: initBooking('calendar', { name: 'Workshop Name', price: 98, maxGuests: 10 });
function initBooking(containerId, opts) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const name = opts.name;
  const price = opts.price || 0;
  const maxGuests = opts.maxGuests || 10;
  const email = 'studio@ebonyfortunatow.com';

  // Seed some available dates (Saturdays and Sundays over next 3 months)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const available = [];
  for (let i = 7; i < 100; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() === 6 || d.getDay() === 0) {
      // Available roughly every other weekend
      if (Math.floor(i / 7) % 2 === 0) available.push(d);
    }
  }
  const availableSet = new Set(available.map(d => d.toDateString()));

  const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  // Open on the month of the first available date so visitors see options straight away
  let current = available.length
    ? new Date(available[0].getFullYear(), available[0].getMonth(), 1)
    : new Date(minMonth);
  let selected = null;
  let guests = 1;

  const fmtLong = d => d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = d => d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const money = n => '$' + n.toLocaleString('en-AU');

  function mailtoHref() {
    const date = selected ? fmtLong(new Date(selected)) : '';
    const subject = `Booking – ${name} – ${date}`;
    const body = [
      'Hi Ebony,',
      '',
      `I'd like to book the following:`,
      '',
      `Workshop: ${name}`,
      `Date: ${date}`,
      `Number of people: ${guests}`,
      `Total: ${money(price * guests)}`,
      '',
      'Name:',
      'Phone:',
      '',
      'Thanks!'
    ].join('\n');
    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function render() {
    // Remember which control had focus so keyboard users don't lose their place on re-render
    const active = document.activeElement;
    const focusKey = active && container.contains(active)
      ? '.' + active.classList[0] + ['data-date', 'data-nav', 'data-guests'].map(a => active.hasAttribute(a) ? `[${a}="${active.getAttribute(a)}"]` : '').join('')
      : '';

    const year = current.getFullYear();
    const month = current.getMonth();
    const monthName = current.toLocaleString('en-AU', { month: 'long' });
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const atMin = current <= minMonth;

    let html = `
      <div class="bk-step">
        <p class="bk-step-title"><span class="bk-num">1</span>Choose a date</p>
        <div class="bk-quick">
          <span class="bk-quick-label">Next available:</span>
          ${available.slice(0, 3).map(d => `
            <button type="button" class="bk-chip${selected === d.toDateString() ? ' active' : ''}" data-date="${d.toDateString()}">${fmtShort(d)}</button>
          `).join('')}
        </div>
        <div class="cal-header">
          <button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month"${atMin ? ' disabled' : ''}>&#8249;</button>
          <span class="cal-title">${monthName} ${year}</span>
          <button type="button" class="cal-nav" data-nav="1" aria-label="Next month">&#8250;</button>
        </div>
        <div class="cal-grid">
          <div class="cal-day-name">Sun</div>
          <div class="cal-day-name">Mon</div>
          <div class="cal-day-name">Tue</div>
          <div class="cal-day-name">Wed</div>
          <div class="cal-day-name">Thu</div>
          <div class="cal-day-name">Fri</div>
          <div class="cal-day-name">Sat</div>
    `;

    for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dateStr = date.toDateString();
      const isPast = date < today;
      const isAvail = availableSet.has(dateStr);
      const isSel = selected === dateStr;

      if (!isPast && isAvail) {
        html += `<button type="button" class="cal-cell available${isSel ? ' selected' : ''}" data-date="${dateStr}" aria-label="${fmtLong(date)} – available"${isSel ? ' aria-pressed="true"' : ''}>${d}</button>`;
      } else {
        html += `<div class="cal-cell ${isPast ? 'past' : 'unavailable'}">${d}</div>`;
      }
    }

    html += `
        </div>
        <div class="cal-legend">
          <span><i class="lg lg-available"></i>Available</span>
          <span><i class="lg lg-selected"></i>Selected</span>
          <span><i class="lg lg-unavailable"></i>Unavailable</span>
        </div>
      </div>

      <div class="bk-step">
        <p class="bk-step-title"><span class="bk-num">2</span>How many people?</p>
        <div class="bk-guests">
          <button type="button" class="bk-stepper" data-guests="-1" aria-label="Fewer people"${guests <= 1 ? ' disabled' : ''}>&minus;</button>
          <span class="bk-guest-count" aria-live="polite">${guests} ${guests === 1 ? 'person' : 'people'}</span>
          <button type="button" class="bk-stepper" data-guests="1" aria-label="More people"${guests >= maxGuests ? ' disabled' : ''}>+</button>
          <span class="bk-guest-note">${money(price)} per person &middot; max ${maxGuests}</span>
        </div>
      </div>

      <div class="bk-step">
        <p class="bk-step-title"><span class="bk-num">3</span>Send your booking request</p>
        <div class="bk-summary">
          <div><span>Workshop</span><p>${name}</p></div>
          <div><span>Date</span><p>${selected ? fmtLong(new Date(selected)) : '<em>Choose a date above</em>'}</p></div>
          <div><span>People</span><p>${guests}</p></div>
          <div class="bk-total"><span>Total</span><p>${money(price * guests)}</p></div>
        </div>
        ${selected
          ? `<a href="${mailtoHref()}" class="btn-solid bk-cta">Request this booking</a>`
          : `<span class="btn-solid bk-cta is-disabled" aria-disabled="true">Choose a date to continue</span>`}
        <p class="bk-fine">Nothing to pay online. This opens an email with your details filled in &mdash; we'll reply to confirm your spot.</p>
      </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        selected = el.dataset.date;
        const d = new Date(selected);
        current = new Date(d.getFullYear(), d.getMonth(), 1);
        render();
      });
    });

    container.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', () => {
        current.setMonth(current.getMonth() + Number(el.dataset.nav));
        if (current < minMonth) current = new Date(minMonth);
        render();
      });
    });

    container.querySelectorAll('[data-guests]').forEach(el => {
      el.addEventListener('click', () => {
        guests = Math.min(maxGuests, Math.max(1, guests + Number(el.dataset.guests)));
        render();
      });
    });

    if (focusKey) {
      const el = container.querySelector(focusKey);
      if (el && !el.disabled) el.focus();
    }
  }

  render();
}
