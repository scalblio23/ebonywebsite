// initCalendar(calendarId, btnId, workshopName, dates?)
// `dates` is an optional list of available dates as 'YYYY-MM-DD' strings,
// e.g. ['2026-11-07', '2026-11-21']. Without it, alternate weekends are shown.
function initCalendar(calendarId, btnId, workshopName, dates) {
  const container = document.getElementById(calendarId);
  const btn = document.getElementById(btnId);
  if (!container) return;

  const EMAIL = 'ebonyfortunatow@gmail.com';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const longDate = d => d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shortDate = d => d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  const available = new Set();
  if (Array.isArray(dates)) {
    dates.forEach(k => available.add(k));
  } else {
    for (let i = 7; i < 100; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      if ((d.getDay() === 6 || d.getDay() === 0) && Math.floor(i / 7) % 2 === 0) {
        available.add(key(d));
      }
    }
  }

  // Open on the month of the first upcoming available date
  const upcoming = [...available].map(fromKey).filter(d => d >= today).sort((a, b) => a - b);
  const start = upcoming[0] || today;
  const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  let selected = null;

  function render() {
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthName = current.toLocaleString('en-AU', { month: 'long' });
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const atMin = current <= minMonth;

    let html = `
      <div class="cal-header">
        <button class="cal-nav" id="cal-prev" aria-label="Previous month"${atMin ? ' disabled style="visibility:hidden"' : ''}>&#8249;</button>
        <span class="cal-title">${monthName} ${year}</span>
        <button class="cal-nav" id="cal-next" aria-label="Next month">&#8250;</button>
      </div>
      <div class="cal-grid">
        <div class="cal-day-name">Mon</div>
        <div class="cal-day-name">Tue</div>
        <div class="cal-day-name">Wed</div>
        <div class="cal-day-name">Thu</div>
        <div class="cal-day-name">Fri</div>
        <div class="cal-day-name">Sat</div>
        <div class="cal-day-name">Sun</div>
    `;

    for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const k = key(date);

      let cls = 'cal-cell';
      if (date < today) cls += ' past';
      else if (selected === k) cls += ' selected';
      else if (available.has(k)) cls += ' available';
      else cls += ' unavailable';

      html += `<div class="${cls}" data-date="${k}">${d}</div>`;
    }

    html += `</div>`;
    if (selected) {
      html += `<p class="cal-selected-label">Selected: <strong>${longDate(fromKey(selected))}</strong></p>`;
    }

    container.innerHTML = html;

    container.querySelectorAll('.cal-cell.available, .cal-cell.selected').forEach(cell => {
      cell.addEventListener('click', () => {
        selected = cell.dataset.date;
        const d = fromKey(selected);
        const subject = encodeURIComponent(`Booking – ${workshopName} – ${longDate(d)}`);
        btn.href = `mailto:${EMAIL}?subject=${subject}`;
        btn.textContent = `Book ${shortDate(d)}`;
        render();
      });
    });

    document.getElementById('cal-prev').addEventListener('click', () => {
      if (current <= minMonth) return;
      current.setMonth(current.getMonth() - 1);
      render();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      current.setMonth(current.getMonth() + 1);
      render();
    });
  }

  render();
}
