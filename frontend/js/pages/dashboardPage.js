import { api } from '../api.js';

export const dashboardPage = {
  async render() {
    return `
      <div id="caretaker-banner-slot"></div>

      <!-- Overview Stat Cards -->
      <div class="stats-grid" id="stats-grid-slot">
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Today's Doses</span>
            <div class="stat-icon" style="background:#e0f2fe; color:#0284c7;">💊</div>
          </div>
          <div class="stat-value" id="stat-total">--</div>
          <div class="stat-footer">Total scheduled today</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Taken / Confirmed</span>
            <div class="stat-icon" style="background:#dcfce7; color:#16a34a;">✓</div>
          </div>
          <div class="stat-value" id="stat-taken" style="color:var(--emerald-600);">--</div>
          <div class="stat-footer">Confirmed on schedule</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Pending</span>
            <div class="stat-icon" style="background:#fef3c7; color:#d97706;">⏳</div>
          </div>
          <div class="stat-value" id="stat-pending" style="color:#d97706;">--</div>
          <div class="stat-footer">Awaiting scheduled time</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Overdue</span>
            <div class="stat-icon" style="background:#fee2e2; color:#dc2626;">⚠️</div>
          </div>
          <div class="stat-value" id="stat-overdue" style="color:var(--status-overdue-badge);">--</div>
          <div class="stat-footer">Grace period expired</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Adherence Rate</span>
            <div class="stat-icon" style="background:#f3e8ff; color:#9333ea;">📈</div>
          </div>
          <div class="stat-value" id="stat-progress">--%</div>
          <div class="stat-footer">Daily completion</div>
        </div>
      </div>

      <!-- Today's Progress Bar -->
      <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:20px; margin-bottom:28px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-weight:600; font-size:15px;">Daily Adherence Progress</span>
          <span id="progress-text" style="font-weight:700; color:var(--primary-600); font-size:15px;">0% Completed</span>
        </div>
        <div class="progress-container">
          <div class="progress-bar" id="progress-bar-inner" style="width: 0%;"></div>
        </div>
      </div>

      <!-- Urgent Overdue Warning Banner (dynamic) -->
      <div id="overdue-alert-slot"></div>

      <!-- Today's Medication Schedule -->
      <div class="section-header">
        <h2 class="section-title">
          <span>📅</span> Today's Medication Schedule
        </h2>
        <div style="display:flex; gap:10px;">
          <a href="#schedule" class="btn btn-outline btn-sm">Full Schedule View →</a>
          <button id="btn-refresh-dashboard" class="btn btn-secondary btn-sm">🔄 Refresh</button>
        </div>
      </div>

      <div class="doses-timeline" id="dashboard-doses-list">
        <div style="text-align:center; padding:40px; color:var(--text-muted);">Loading today's schedule...</div>
      </div>

      <!-- Bottom Grid: Low Stock Alert & System Health -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:24px; margin-top:32px;">
        <!-- Stock Alerts -->
        <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:24px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h3 style="font-size:16px; font-weight:700; display:flex; align-items:center; gap:8px;">
              <span>📦</span> Inventory & Refill Alerts
            </h3>
            <a href="#inventory" class="btn btn-outline btn-sm">Manage Inventory</a>
          </div>
          <div id="stock-alerts-slot">
            <div style="color:var(--text-muted); font-size:13px;">Checking stock levels...</div>
          </div>
        </div>

        <!-- Caretaker Notification Engine Status -->
        <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:24px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h3 style="font-size:16px; font-weight:700; display:flex; align-items:center; gap:8px;">
              <span>🔔</span> Notification Channels Status
            </h3>
            <a href="#notifications" class="btn btn-outline btn-sm">Settings</a>
          </div>
          <div id="channel-status-slot">
            <div style="color:var(--text-muted); font-size:13px;">Checking notification engine...</div>
          </div>
        </div>
      </div>
    `;
  },

  async init() {
    const user = api.getUser();

    // 1. If Caretaker, render Patient Switcher Banner
    if (user?.role === 'caretaker') {
      await this.renderCaretakerBanner();
    }

    // 2. Load daily doses and stats
    await this.loadDoses();

    // 3. Load stock alerts
    await this.loadStockAlerts();

    // 4. Load notification engine statuses
    await this.loadChannelStatuses();

    // Refresh button
    document.getElementById('btn-refresh-dashboard')?.addEventListener('click', () => {
      this.init();
    });
  },

  async renderCaretakerBanner() {
    const slot = document.getElementById('caretaker-banner-slot');
    if (!slot) return;

    try {
      const res = await api.get('/caretakers/my-patients');
      const patients = res.patients || [];

      let optionsHtml = '';
      const currentActive = api.getActivePatientId();

      patients.forEach(p => {
        const patientData = p.patient || {};
        const isSelected = patientData.id === currentActive ? 'selected' : '';
        optionsHtml += `<option value="${patientData.id}" ${isSelected}>${patientData.full_name} (${p.relationship_type})</option>`;
      });

      slot.innerHTML = `
        <div class="caretaker-view-banner">
          <div class="banner-text">
            <span style="font-size:24px;">🛡️</span>
            <div>
              <div style="font-weight:700;">Caretaker Mode Active</div>
              <div style="font-size:12px; opacity:0.9;">Monitoring authorized patient medication schedules in real-time.</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <label style="font-size:13px; font-weight:600;">Active Patient:</label>
            <select id="caretaker-patient-select" style="padding:6px 12px; border-radius:var(--radius-md); border:none; background:white; color:#0f172a; font-weight:600;">
              ${optionsHtml || '<option value="">No patients linked yet</option>'}
            </select>
          </div>
        </div>
      `;

      document.getElementById('caretaker-patient-select')?.addEventListener('change', (e) => {
        api.setActivePatientId(e.target.value);
        window.app.showToast('Switched patient view', 'info');
        this.loadDoses();
        this.loadStockAlerts();
      });

      // If no active patient is set, select first
      if (!currentActive && patients.length > 0) {
        api.setActivePatientId(patients[0].patient_id);
      }
    } catch (err) {
      console.error('Error rendering caretaker banner:', err);
    }
  },

  async loadDoses() {
    const listSlot = document.getElementById('dashboard-doses-list');
    const overdueSlot = document.getElementById('overdue-alert-slot');
    const patientId = api.getActivePatientId();

    try {
      const res = await api.get('/doses/today', { patientId });
      const { summary, doses } = res;

      // Update stat cards
      document.getElementById('stat-total').textContent = summary.total;
      document.getElementById('stat-taken').textContent = summary.taken;
      document.getElementById('stat-pending').textContent = summary.pending;
      document.getElementById('stat-overdue').textContent = summary.overdue;
      document.getElementById('stat-progress').textContent = `${summary.progress}%`;

      document.getElementById('progress-text').textContent = `${summary.progress}% Completed (${summary.taken} of ${summary.total} doses)`;
      document.getElementById('progress-bar-inner').style.width = `${summary.progress}%`;

      // Overdue alert banner if any dose is overdue
      if (summary.overdue > 0) {
        overdueSlot.innerHTML = `
          <div style="background:#fef2f2; border:1px solid #fecaca; border-left:6px solid #dc2626; border-radius:var(--radius-lg); padding:18px 24px; margin-bottom:28px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:16px;">
              <span style="font-size:28px;">🚨</span>
              <div>
                <h4 style="font-size:16px; font-weight:700; color:#991b1b;">ATTENTION: ${summary.overdue} Medication dose(s) are Overdue!</h4>
                <p style="font-size:13px; color:#b91c1c; margin-top:2px;">The configured grace period has expired. Caretakers have been automatically alerted through enabled notification channels.</p>
              </div>
            </div>
            <a href="#schedule" class="btn btn-sm" style="background:#dc2626; color:white;">Take Action Now</a>
          </div>
        `;
      } else {
        overdueSlot.innerHTML = '';
      }

      // Render medication list
      if (!doses || doses.length === 0) {
        listSlot.innerHTML = `
          <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:40px; text-align:center;">
            <p style="color:var(--text-muted); font-size:15px; margin-bottom:16px;">No medicines scheduled for today.</p>
            <a href="#medicines" class="btn btn-primary btn-sm">+ Add Your First Medicine</a>
          </div>
        `;
        return;
      }

      let html = '';
      doses.forEach(dose => {
        const med = dose.medicine || {};
        const inv = Array.isArray(med.medicine_inventory) ? med.medicine_inventory[0] : med.medicine_inventory;
        const isOutOfStock = inv && Number(inv.current_stock) <= 0;
        const isLowStock = inv && Number(inv.current_stock) > 0 && Number(inv.current_stock) <= Number(inv.low_stock_threshold);
        const isTaken = dose.status === 'taken';
        const isOverdue = dose.status === 'overdue';
        const isPending = dose.status === 'pending';
        const isSkipped = dose.status === 'skipped';

        const statusClass = isTaken ? 'is-taken' : isOverdue ? 'is-overdue' : isPending ? 'is-pending' : '';
        const badgeClass = `status-${dose.status}`;

        // Format food timing label
        const foodLabel = med.food_timing ? med.food_timing.replace('_', ' ') : 'anytime';

        html += `
          <div class="dose-card ${statusClass}" id="dose-card-${dose.id}">
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
                  <span><strong>Quantity:</strong> ${dose.dose_quantity || 1} ${med.medicine_type || 'tablet'}</span>
                  <span>•</span>
                  <span class="dose-tag">🍽️ ${foodLabel}</span>
                  ${isOutOfStock ? '<span class="dose-tag" style="background:#fee2e2; color:#dc2626; font-weight:700;">🚨 Out of Stock (0 remaining)</span>' : ''}
                  ${isLowStock ? `<span class="dose-tag" style="background:#fef3c7; color:#d97706; font-weight:600;">⚠️ Low Stock (${inv.current_stock} remaining)</span>` : ''}
                  ${med.prescribing_doctor_name ? `<span>• <small>Dr. ${med.prescribing_doctor_name}</small></span>` : ''}
                </div>
              </div>
            </div>

            <div class="dose-right">
              <span class="status-badge ${badgeClass}">${dose.status}</span>

              ${isTaken ? `
                <div class="taken-confirmation-stamp">
                  <span>✓ Confirmed</span>
                  <span style="font-size:11px; color:var(--text-muted);">${new Date(dose.confirmed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
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

      // Attach event listeners for Mark as Taken
      document.querySelectorAll('.btn-mark-taken').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const doseId = e.currentTarget.getAttribute('data-id');
          await this.markTaken(doseId);
        });
      });

      // Attach event listeners for Skip
      document.querySelectorAll('.btn-skip-dose').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const doseId = e.currentTarget.getAttribute('data-id');
          this.promptSkip(doseId);
        });
      });

    } catch (err) {
      listSlot.innerHTML = `<div style="color:#ef4444; padding:20px;">Failed to load schedule: ${err.message}</div>`;
    }
  },

  async markTaken(doseId) {
    try {
      window.app.showToast('Confirming dose...', 'info');
      await api.post(`/doses/${doseId}/take`, {});
      window.app.showToast('Dose confirmed as TAKEN! Inventory updated.', 'success');
      await this.loadDoses();
      await this.loadStockAlerts();
    } catch (err) {
      window.app.showToast(err.message, 'error');
    }
  },

  promptSkip(doseId) {
    const reason = prompt('Please enter a reason for skipping this scheduled dose:');
    if (!reason) return;

    api.post(`/doses/${doseId}/skip`, { reason })
      .then(() => {
        window.app.showToast('Dose recorded as skipped.', 'info');
        this.loadDoses();
      })
      .catch(err => window.app.showToast(err.message, 'error'));
  },

  async loadStockAlerts() {
    const slot = document.getElementById('stock-alerts-slot');
    if (!slot) return;

    try {
      const patientId = api.getActivePatientId();
      const res = await api.get('/inventory', { patientId });
      const items = res.inventory || [];
      const lowItems = items.filter(i => i.isLowStock);

      if (lowItems.length === 0) {
        slot.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px; color:var(--emerald-600); font-size:13px; padding:12px 0;">
            <span>✓</span> All medications have sufficient stock levels.
          </div>
        `;
        return;
      }

      let html = '<div style="display:flex; flex-direction:column; gap:10px;">';
      lowItems.forEach(item => {
        const medName = item.medicines?.name || 'Medicine';
        html += `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--bg-surface-alt); border-radius:var(--radius-md); border-left:4px solid var(--status-overdue-badge);">
            <div>
              <div style="font-weight:700; font-size:14px;">${medName}</div>
              <div style="font-size:12px; color:var(--text-muted);">${item.current_stock} ${item.unit_name} remaining (~${item.estimatedRemainingDays} days left)</div>
            </div>
            <a href="#inventory" class="btn btn-secondary btn-sm">Refill</a>
          </div>
        `;
      });
      html += '</div>';

      slot.innerHTML = html;
    } catch (err) {
      slot.innerHTML = `<div style="color:var(--text-muted); font-size:12px;">Stock info unavailable.</div>`;
    }
  },

  async loadChannelStatuses() {
    const slot = document.getElementById('channel-status-slot');
    if (!slot) return;

    try {
      const res = await api.get('/notifications/status');
      const channels = res.channels || {};

      let html = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">';
      for (const [name, info] of Object.entries(channels)) {
        const isLive = info.mode === 'LIVE';
        const badgeColor = isLive ? 'var(--emerald-500)' : '#f59e0b';
        html += `
          <div style="padding:10px; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--bg-surface-alt); font-size:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong style="text-transform:uppercase;">${name}</strong>
              <span style="font-size:10px; font-weight:700; color:${badgeColor};">${info.mode}</span>
            </div>
            <div style="color:var(--text-muted); font-size:11px;">${isLive ? 'Active provider connected' : 'Simulation fallback active'}</div>
          </div>
        `;
      }
      html += '</div>';

      slot.innerHTML = html;
    } catch (err) {
      slot.innerHTML = `<div style="color:var(--text-muted); font-size:12px;">Notification status unavailable.</div>`;
    }
  },
};

