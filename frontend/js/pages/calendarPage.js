import { api } from '../api.js';

export const calendarPage = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(), // 0-indexed
  selectedDateStr: new Date().toISOString().split('T')[0],

  async render() {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>🗓️</span> Medication Calendar & Historical Timeline</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Review daily adherence history, inspect late or unconfirmed doses, and preserve an unalterable medical audit trail.
          </p>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 380px; gap:24px; align-items:start;">
        <!-- Calendar Grid -->
        <div class="calendar-container">
          <div class="calendar-header">
            <h3 id="cal-month-title" style="font-size:18px; font-weight:700;">November 2026</h3>
            <div style="display:flex; gap:8px;">
              <button id="btn-cal-prev" class="btn btn-secondary btn-sm">‹ Previous</button>
              <button id="btn-cal-today" class="btn btn-secondary btn-sm">Current Month</button>
              <button id="btn-cal-next" class="btn btn-secondary btn-sm">Next ›</button>
            </div>
          </div>

          <div class="calendar-grid" id="calendar-grid-slot">
            <!-- Day Headers -->
            <div class="calendar-day-header">Mon</div>
            <div class="calendar-day-header">Tue</div>
            <div class="calendar-day-header">Wed</div>
            <div class="calendar-day-header">Thu</div>
            <div class="calendar-day-header">Fri</div>
            <div class="calendar-day-header">Sat</div>
            <div class="calendar-day-header">Sun</div>
          </div>

          <div style="display:flex; gap:16px; margin-top:16px; font-size:12px; color:var(--text-muted);">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="cal-dot green"></span> Taken
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="cal-dot yellow"></span> Pending
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="cal-dot orange"></span> Overdue / Alerted
            </div>
          </div>
        </div>

        <!-- Selected Date Details Panel -->
        <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:24px;">
          <h3 style="font-size:16px; font-weight:700; margin-bottom:4px;">Date Record Details</h3>
          <p id="selected-date-label" style="font-size:13px; color:var(--primary-600); font-weight:600; margin-bottom:16px;"></p>

          <div id="selected-date-doses-slot" style="display:flex; flex-direction:column; gap:12px;">
            <div style="color:var(--text-muted); font-size:13px;">Select a date to view doses.</div>
          </div>
        </div>
      </div>
    `;
  },

  async init() {
    document.getElementById('btn-cal-prev')?.addEventListener('click', () => {
      this.currentMonth--;
      if (this.currentMonth < 0) {
        this.currentMonth = 11;
        this.currentYear--;
      }
      this.renderCalendar();
    });

    document.getElementById('btn-cal-next')?.addEventListener('click', () => {
      this.currentMonth++;
      if (this.currentMonth > 11) {
        this.currentMonth = 0;
        this.currentYear++;
      }
      this.renderCalendar();
    });

    document.getElementById('btn-cal-today')?.addEventListener('click', () => {
      const now = new Date();
      this.currentYear = now.getFullYear();
      this.currentMonth = now.getMonth();
      this.selectedDateStr = now.toISOString().split('T')[0];
      this.renderCalendar();
    });

    await this.renderCalendar();
  },

  async renderCalendar() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('cal-month-title').textContent = `${monthNames[this.currentMonth]} ${this.currentYear}`;

    const grid = document.getElementById('calendar-grid-slot');
    // Keep 7 day headers
    grid.innerHTML = `
      <div class="calendar-day-header">Mon</div>
      <div class="calendar-day-header">Tue</div>
      <div class="calendar-day-header">Wed</div>
      <div class="calendar-day-header">Thu</div>
      <div class="calendar-day-header">Fri</div>
      <div class="calendar-day-header">Sat</div>
      <div class="calendar-day-header">Sun</div>
    `;

    // Fetch dose history for the entire month
    const firstDayOfMonth = new Date(this.currentYear, this.currentMonth, 1);
    const lastDayOfMonth = new Date(this.currentYear, this.currentMonth + 1, 0);

    const startStr = firstDayOfMonth.toISOString().split('T')[0];
    const endStr = lastDayOfMonth.toISOString().split('T')[0];

    const patientId = api.getActivePatientId();
    let monthDoses = [];
    try {
      const res = await api.get('/doses/history', { patientId, startDate: startStr, endDate: endStr });
      monthDoses = res.history || [];
    } catch (e) {
      console.warn('Failed to fetch month doses:', e);
    }

    // Map doses by date
    const dosesByDate = {};
    monthDoses.forEach(d => {
      if (!dosesByDate[d.scheduled_date]) dosesByDate[d.scheduled_date] = [];
      dosesByDate[d.scheduled_date].push(d);
    });

    // Determine leading blanks (1=Mon, ..., 7=Sun)
    let startDayOfWeek = firstDayOfMonth.getDay();
    startDayOfWeek = startDayOfWeek === 0 ? 7 : startDayOfWeek; // 1-7 Mon-Sun

    for (let i = 1; i < startDayOfWeek; i++) {
      const blank = document.createElement('div');
      blank.style.minHeight = '70px';
      blank.style.opacity = '0.3';
      grid.appendChild(blank);
    }

    const totalDays = lastDayOfMonth.getDate();
    for (let day = 1; day <= totalDays; day++) {
      const dayStr = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayDoses = dosesByDate[dayStr] || [];
      const isSelected = dayStr === this.selectedDateStr;

      let pillsHtml = '';
      const hasOverdue = dayDoses.some(d => d.status === 'overdue' || d.caretaker_alert_sent);
      const hasTaken = dayDoses.some(d => d.status === 'taken');
      const hasPending = dayDoses.some(d => d.status === 'pending');

      if (hasTaken) pillsHtml += `<span class="cal-dot green" title="Doses taken"></span>`;
      if (hasPending) pillsHtml += `<span class="cal-dot yellow" title="Doses pending"></span>`;
      if (hasOverdue) pillsHtml += `<span class="cal-dot orange" title="Doses overdue"></span>`;

      const cell = document.createElement('div');
      cell.className = `calendar-cell ${isSelected ? 'is-selected' : ''}`;
      cell.innerHTML = `
        <span class="calendar-date-num">${day}</span>
        <div class="calendar-pills">${pillsHtml}</div>
      `;

      cell.addEventListener('click', () => {
        document.querySelectorAll('.calendar-cell').forEach(c => c.classList.remove('is-selected'));
        cell.classList.add('is-selected');
        this.selectedDateStr = dayStr;
        this.loadDateDetails(dayStr, dayDoses);
      });

      grid.appendChild(cell);
    }

    // Load initial selected date details
    const initialDoses = dosesByDate[this.selectedDateStr] || [];
    this.loadDateDetails(this.selectedDateStr, initialDoses);
  },

  async loadDateDetails(dateStr, doses = []) {
    const label = document.getElementById('selected-date-label');
    const slot = document.getElementById('selected-date-doses-slot');
    label.textContent = new Date(dateStr + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    if (doses.length === 0) {
      // Try to fetch if not preloaded
      try {
        const patientId = api.getActivePatientId();
        const res = await api.get('/doses/today', { patientId, date: dateStr });
        doses = res.doses || [];
      } catch (err) {
        console.warn(err);
      }
    }

    if (doses.length === 0) {
      slot.innerHTML = `<div style="color:var(--text-muted); font-size:13px; padding:20px 0;">No dose records for this date.</div>`;
      return;
    }

    let html = '';
    doses.forEach(d => {
      const med = d.medicines || d.medicine || {};
      html += `
        <div style="padding:12px; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--bg-surface-alt);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${med.name || 'Medicine'}</strong>
            <span class="status-badge status-${d.status}" style="font-size:11px;">${d.status}</span>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
            Scheduled: <strong>${d.scheduled_time?.slice(0, 5)}</strong> | Qty: ${d.dose_quantity || 1}
          </div>
          ${d.confirmed_at ? `<div style="font-size:11px; color:var(--emerald-600); margin-top:2px;">Confirmed at: ${new Date(d.confirmed_at).toLocaleTimeString()}</div>` : ''}
          ${d.skip_reason ? `<div style="font-size:11px; color:#d97706; margin-top:2px;">Skipped: "${d.skip_reason}"</div>` : ''}
          ${d.caretaker_alert_sent ? `<div style="font-size:11px; color:#dc2626; font-weight:600; margin-top:2px;">🚨 Caretaker alert triggered</div>` : ''}
        </div>
      `;
    });

    slot.innerHTML = html;
  },
};

