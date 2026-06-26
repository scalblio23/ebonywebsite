function initCalendar(calendarId, btnId, workshopName) {
  const container = document.getElementById(calendarId);
  const btn = document.getElementById(btnId);
  if (!container) return;

  // Seed some available dates (Saturdays and Sundays over next 3 months)
  const today = new Date();
  const available = new Set();
  for (let i = 7; i < 100; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() === 6 || d.getDay() === 0) {
      // Available roughly every other weekend
      if (Math.floor(i / 7) % 2 === 0) {
        available.add(d.toDateString());
      }
    }
  }

  let current = new Date(today.getFullYear(), today.getMonth(), 1);
  let selected = null;

  function render() {
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthName = current.toLocaleString('default', { month: 'long' });
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = `
      <div class="cal-header">
        <button class="cal-nav" id="cal-prev">&#8249;</button>
        <span class="cal-title">${monthName} ${year}</span>
        <button class="cal-nav" id="cal-next">&#8250;</button>
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
      const isAvail = available.has(dateStr);
      const isSel = selected === dateStr;

      let cls = 'cal-cell';
      if (isPast) cls += ' past';
      else if (isSel) cls += ' selected';
      else if (isAvail) cls += ' available';
      else cls += ' unavailable';

      html += `<div class="${cls}" data-date="${dateStr}">${d}</div>`;
    }

    html += `</div>`;
    if (selected) {
      html += `<p class="cal-selected-label">Selected: <strong>${selected}</strong></p>`;
    }

    container.innerHTML = html;

    container.querySelectorAll('.cal-cell.available').forEach(cell => {
      cell.addEventListener('click', () => {
        selected = cell.dataset.date;
        const subject = encodeURIComponent(`Booking – ${workshopName} – ${selected}`);
        btn.href = `mailto:studio@ebonyfortunatow.com?subject=${subject}`;
        btn.textContent = `Book ${selected}`;
        render();
      });
    });

    document.getElementById('cal-prev').addEventListener('click', () => {
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
