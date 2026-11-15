import { api } from '../api.js';

export const schedulePage = {
  selectedDate: new Date().toISOString().split('T')[0],
  currentFilter: 'all',

  async render() {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>⏰</span> Daily Medication Schedule & Dose Tracking</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Track scheduled intake times, mark doses as taken, and monitor adherence in real-time.
          </p>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <input type="date" id="schedule-date-picker" class="form-control" style="width:160px;" value="${this.selectedDate}" />
          <button id="btn-schedule-today" class="btn btn-secondary btn-sm">Today</button>
        </div>
      </div>

      <!-- Filter Pills -->
      <div class="filter-bar">
        <button class="filter-pill active" data-filter="all">All Doses</button>
        <button class="filter-pill" data-filter="pending">⏳ Pending</button>
        <button class="filter-pill" data-filter="taken">✓ Taken / Confirmed</button>
        <button class="filter-pill" data-filter="overdue">⚠️ Overdue</button>
        <button class="filter-pill" data-filter="skipped">⏭️ Skipped</button>
      </div>

      <!-- Timeline List -->
      <div class="doses-timeline" id="schedule-doses-list">
        <div style="text-align:center; padding:40px; color:var(--text-muted);">Loading doses...</div>
      </div>
    `;
  },

  async init() {
    const datePicker = document.getElementById('schedule-date-picker');
    const todayBtn = document.getElementById('btn-schedule-today');

    datePicker?.addEventListener('change', (e) => {
      this.selectedDate = e.target.value;
      this.loadDoses();
    });

    todayBtn?.addEventListener('click', () => {
      this.selectedDate = new Date().toISOString().split('T')[0];
      if (datePicker) datePicker.value = this.selectedDate;
      this.loadDoses();
    });

    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentFilter = e.currentTarget.getAttribute('data-filter');
        this.loadDoses();
      });
    });

    await this.loadDoses();
  },

  async loadDoses() {
    const listSlot = document.getElementById('schedule-doses-list');
    const patientId = api.getActivePatientId();

    try {
      const res = await api.get('/doses/today', { patientId, date: this.selectedDate });
      let doses = res.doses || [];

      if (this.currentFilter !== 'all') {
        doses = doses.filter(d => d.status === this.currentFilter);
      }

      if (doses.length === 0) {
        listSlot.innerHTML = `
          <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:40px; text-align:center; color:var(--text-muted);">
            No doses found for this date and filter.
          </div>
        `;
        return;
      }

      let html = '';
      doses.forEach(dose => {
        const med = dose.medicine || {};
        const isTaken = dose.status === 'taken';
        const isOverdue = dose.status === 'overdue';
        const isPending = dose.status === 'pending';
        const statusClass = isTaken ? 'is-taken' : isOverdue ? 'is-overdue' : isPending ? 'is-pending' : '';
        const foodLabel = med.food_timing ? med.food_timing.replace('_', ' ') : 'anytime';

        html += `
          <div class="dose-card ${statusClass}">
            <div class="dose-left">
              <div class="dose-time-box">
                <span class="dose-time">${dose.scheduled_time.slice(0, 5)}</span>
                <span class="dose-period">${parseInt(dose.scheduled_time.slice(0, 2), 10) >= 12 ? 'PM' : 'AM'}</span>
              </div>
              <div class="dose-info">
                <h4>
                  ${med.name || 'Medicine'}
                  ${med.brand_name ? `<span class="dose-brand">(${med.brand_name})</span>` : ''}
                </h4>
                <div class="dose-meta">
                  <span><strong>Dosage:</strong> ${med.prescribed_dosage || ''}</span>
                  <span>•</span>
                  <span><strong>Qty:</strong> ${dose.dose_quantity || 1} ${med.medicine_type || 'tablet'}</span>
                  <span>•</span>
                  <span class="dose-tag">🍽️ ${foodLabel}</span>
                  ${dose.caretaker_alert_sent ? '<span class="dose-tag" style="background:#fee2e2; color:#dc2626;">🚨 Caretaker Alerted</span>' : ''}
                  ${dose.skip_reason ? `<span style="color:#d97706;">(Skipped: "${dose.skip_reason}")</span>` : ''}
                </div>
              </div>
            </div>

            <div class="dose-right">
              <span class="status-badge status-${dose.status}">${dose.status}</span>

              ${isTaken ? `
                <div class="taken-confirmation-stamp">
                  <span>✓ Confirmed</span>
                  <span style="font-size:11px; color:var(--text-muted);">${new Date(dose.confirmed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <button class="btn btn-outline btn-sm btn-correct-dose" data-id="${dose.id}">Correct</button>
              ` : `
                <button class="btn btn-success btn-sm btn-mark-taken" data-id="${dose.id}">
                  ✓ Mark as Taken
                </button>
                <button class="btn btn-outline btn-sm btn-skip-dose" data-id="${dose.id}">
                  Skip
                </button>
              `}
            </div>
          </div>
        `;
      });

      listSlot.innerHTML = html;

      // Bind Mark as Taken
      document.querySelectorAll('.btn-mark-taken').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const doseId = e.currentTarget.getAttribute('data-id');
          try {
            window.app.showToast('Confirming dose...', 'info');
            await api.post(`/doses/${doseId}/take`, {});
            window.app.showToast('Dose confirmed as TAKEN! Inventory deducted.', 'success');
            await this.loadDoses();
          } catch (err) {
            window.app.showToast(err.message, 'error');
          }
        });
      });

      // Bind Skip
      document.querySelectorAll('.btn-skip-dose').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const doseId = e.currentTarget.getAttribute('data-id');
          const reason = prompt('Please enter a reason for skipping:');
          if (!reason) return;

          api.post(`/doses/${doseId}/skip`, { reason })
            .then(() => {
              window.app.showToast('Dose marked as skipped.', 'info');
              this.loadDoses();
            })
            .catch(err => window.app.showToast(err.message, 'error'));
        });
      });

      // Bind Correct
      document.querySelectorAll('.btn-correct-dose').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const doseId = e.currentTarget.getAttribute('data-id');
          const newStatus = prompt('Enter corrected status (pending / skipped / taken):', 'pending');
          if (!newStatus) return;
          const reason = prompt('Reason for status correction:');
          if (!reason) return;

          api.post(`/doses/${doseId}/correct`, { newStatus, reason })
            .then(() => {
              window.app.showToast('Status corrected and audit log recorded.', 'success');
              this.loadDoses();
            })
            .catch(err => window.app.showToast(err.message, 'error'));
        });
      });

    } catch (err) {
      listSlot.innerHTML = `<div style="color:#ef4444; padding:20px;">Failed to load doses: ${err.message}</div>`;
    }
  },
};

