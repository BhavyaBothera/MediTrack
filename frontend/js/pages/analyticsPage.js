import { api } from '../api.js';

export const analyticsPage = {
  selectedDays: 30,

  async render() {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>📊</span> Medication Adherence Analytics & Reports</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Calculate daily, weekly, and monthly adherence metrics, confirmation delays, and export compliance reports.
          </p>
        </div>
        <div style="display:flex; gap:10px;">
          <button id="btn-export-csv" class="btn btn-outline btn-sm">📥 Export CSV</button>
          <button id="btn-export-pdf" class="btn btn-primary btn-sm">📄 Export PDF Report</button>
        </div>
      </div>

      <!-- Time Range Filter Pills -->
      <div class="filter-bar">
        <button class="filter-pill" data-days="7">Last 7 Days</button>
        <button class="filter-pill active" data-days="30">Last 30 Days</button>
        <button class="filter-pill" data-days="90">Last 90 Days</button>
      </div>

      <!-- Key Analytics Metrics -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Adherence Rate</span>
            <div class="stat-icon" style="background:#ecfdf5; color:#059669;">🎯</div>
          </div>
          <div class="stat-value" id="ana-stat-adherence" style="color:var(--emerald-600);">--%</div>
          <div class="stat-footer">Doses taken vs scheduled</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Scheduled Doses</span>
            <div class="stat-icon" style="background:#e0f2fe; color:#0284c7;">📋</div>
          </div>
          <div class="stat-value" id="ana-stat-scheduled">--</div>
          <div class="stat-footer">Total in selected period</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Confirmed Taken</span>
            <div class="stat-icon" style="background:#dcfce7; color:#16a34a;">✓</div>
          </div>
          <div class="stat-value" id="ana-stat-taken" style="color:var(--emerald-600);">--</div>
          <div class="stat-footer">Confirmed intakes</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Avg Delay</span>
            <div class="stat-icon" style="background:#fef3c7; color:#d97706;">⏱️</div>
          </div>
          <div class="stat-value" id="ana-stat-delay">-- min</div>
          <div class="stat-footer">From scheduled time</div>
        </div>
      </div>

      <!-- Daily Adherence Trend Chart -->
      <div class="chart-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="font-size:16px; font-weight:700;">Daily Adherence Percentage Trend</h3>
          <span style="font-size:12px; color:var(--text-muted);">Green = 100% adherence</span>
        </div>
        <div class="bar-chart-container" id="trend-chart-slot">
          <div style="margin:auto; color:var(--text-muted); font-size:13px;">Loading adherence trend...</div>
        </div>
      </div>

      <!-- Medicine-wise Breakdown -->
      <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:24px;">
        <h3 style="font-size:16px; font-weight:700; margin-bottom:16px;">Medicine-wise Adherence Breakdown</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Scheduled</th>
                <th>Confirmed Taken</th>
                <th style="width:240px;">Adherence Compliance</th>
                <th style="text-align:right;">Rate</th>
              </tr>
            </thead>
            <tbody id="medicine-breakdown-body">
              <tr><td colspan="5" style="text-align:center; padding:30px;">Loading breakdown...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async init() {
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.selectedDays = parseInt(e.currentTarget.getAttribute('data-days'), 10);
        this.loadMetrics();
      });
    });

    document.getElementById('btn-export-csv')?.addEventListener('click', () => this.exportReport('csv'));
    document.getElementById('btn-export-pdf')?.addEventListener('click', () => this.exportReport('pdf'));

    await this.loadMetrics();
  },

  async loadMetrics() {
    const patientId = api.getActivePatientId();
    const chartSlot = document.getElementById('trend-chart-slot');
    const tableBody = document.getElementById('medicine-breakdown-body');

    try {
      const res = await api.get('/analytics', { patientId, days: this.selectedDays });
      const m = res.metrics;

      document.getElementById('ana-stat-adherence').textContent = `${m.adherencePercentage}%`;
      document.getElementById('ana-stat-scheduled').textContent = m.totalScheduled;
      document.getElementById('ana-stat-taken').textContent = m.totalTaken;
      document.getElementById('ana-stat-delay').textContent = `${m.averageConfirmationDelayMinutes}m`;

      // Render Bar Chart
      if (!m.dailyTrends || m.dailyTrends.length === 0) {
        chartSlot.innerHTML = `<div style="margin:auto; color:var(--text-muted); font-size:13px;">No historical doses in this period.</div>`;
      } else {
        let chartHtml = '';
        m.dailyTrends.forEach(item => {
          const heightPx = Math.max(10, Math.round((item.percentage / 100) * 160));
          const color = item.percentage >= 80 ? 'linear-gradient(180deg, #10b981, #059669)' : item.percentage >= 50 ? 'linear-gradient(180deg, #f59e0b, #d97706)' : 'linear-gradient(180deg, #ef4444, #b91c1c)';
          chartHtml += `
            <div class="bar-group" title="${item.date}: ${item.percentage}% (${item.taken}/${item.scheduled})">
              <span style="font-size:10px; font-weight:700; color:var(--text-secondary);">${item.percentage}%</span>
              <div class="bar-fill" style="height:${heightPx}px; background:${color};"></div>
              <span class="bar-label">${item.date.slice(5)}</span>
            </div>
          `;
        });
        chartSlot.innerHTML = chartHtml;
      }

      // Render Medicine Breakdown
      if (!m.medicineBreakdown || m.medicineBreakdown.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No medicines found.</td></tr>`;
      } else {
        let medHtml = '';
        m.medicineBreakdown.forEach(item => {
          const color = item.percentage >= 80 ? 'var(--emerald-500)' : item.percentage >= 50 ? '#f59e0b' : '#ef4444';
          medHtml += `
            <tr>
              <td><strong>${item.medicineName}</strong></td>
              <td>${item.scheduled} doses</td>
              <td>${item.taken} doses</td>
              <td>
                <div class="progress-container" style="margin:0;">
                  <div class="progress-bar" style="width:${item.percentage}%; background:${color};"></div>
                </div>
              </td>
              <td style="text-align:right; font-weight:700; color:${color};">${item.percentage}%</td>
            </tr>
          `;
        });
        tableBody.innerHTML = medHtml;
      }

    } catch (err) {
      console.error(err);
      window.app.showToast(`Failed to load metrics: ${err.message}`, 'error');
    }
  },

  async exportReport(format) {
    const patientId = api.getActivePatientId();
    window.app.showToast(`Generating ${format.toUpperCase()} report...`, 'info');

    try {
      const blob = await api.get(`/analytics/export/${format}`, { patientId, days: this.selectedDays });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meditrack_adherence_report_${this.selectedDays}days.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      window.app.showToast(`${format.toUpperCase()} download started!`, 'success');
    } catch (err) {
      window.app.showToast(`Export failed: ${err.message}`, 'error');
    }
  },
};

