import { api } from '../api.js';

export const notificationsPage = {
  async render() {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>🔔</span> Notification Center & Channel Settings</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Manage automated alerts, delivery channels (WhatsApp, Email, SMS, Push), quiet hours, and review logs.
          </p>
        </div>
        <button id="btn-trigger-test-alert" class="btn btn-secondary btn-sm">
          ⚡ Trigger Test Alert
        </button>
      </div>

      <!-- Channel Engine Status Card -->
      <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:24px; margin-bottom:28px;">
        <h3 style="font-size:16px; font-weight:700; margin-bottom:12px;">Delivery Channels Configuration</h3>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
          Channels with external credentials active run in <strong>LIVE</strong> mode. Other channels run in safe <strong>SIMULATED TEST MODE</strong> (logged transparently without failing).
        </p>
        <div id="notif-channels-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px;">
          <div style="color:var(--text-muted); font-size:13px;">Checking channels...</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 340px; gap:24px; align-items:start;">
        <!-- Notification Feed -->
        <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); overflow:hidden;">
          <div style="padding:20px 24px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:16px; font-weight:700;">Alert History & Delivery Feed</h3>
            <button id="btn-refresh-notifs" class="btn btn-outline btn-sm">Refresh Feed</button>
          </div>
          <div id="notifications-feed-slot">
            <div style="padding:40px; text-align:center; color:var(--text-muted);">Loading alerts...</div>
          </div>
        </div>

        <!-- Notification Preferences -->
        <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:24px;">
          <h3 style="font-size:16px; font-weight:700; margin-bottom:16px;">My Alert Channels</h3>
          <form id="notif-pref-form">
            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px; font-size:14px;">
              <label style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="pref-in-app" checked disabled /> In-App Notification Center
              </label>
              <label style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="pref-email" checked /> Email Notifications
              </label>
              <label style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="pref-push" checked /> Browser Push Notifications
              </label>
              <label style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="pref-whatsapp" /> WhatsApp Alerts
              </label>
              <label style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="pref-sms" /> SMS Alerts
              </label>
            </div>

            <h4 style="font-size:14px; font-weight:600; margin-bottom:8px;">Quiet Hours (Optional)</h4>
            <div class="form-row" style="margin-bottom:16px;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:11px;">From</label>
                <input type="time" id="pref-quiet-start" class="form-control" />
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:11px;">To</label>
                <input type="time" id="pref-quiet-end" class="form-control" />
              </div>
            </div>
            <small style="color:var(--text-muted); font-size:11px; display:block; margin-bottom:16px;">
              Note: Critical overdue caretaker alerts bypass quiet hours to guarantee patient safety.
            </small>

            <button type="submit" class="btn btn-primary btn-sm" style="width:100%;">Save Preferences</button>
          </form>
        </div>
      </div>
    `;
  },

  async init() {
    await this.loadChannelStatus();
    await this.loadNotifications();
    await this.loadPreferences();

    document.getElementById('btn-refresh-notifs')?.addEventListener('click', () => this.loadNotifications());

    // Test Alert Button
    document.getElementById('btn-trigger-test-alert')?.addEventListener('click', async () => {
      try {
        window.app.showToast('Triggering test alert across enabled channels...', 'info');
        const res = await api.post('/notifications/test-trigger', { type: 'caretaker_overdue_alert' });
        window.app.showToast('Test notification delivered and logged!', 'success');
        await this.loadNotifications();
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });

    // Preferences form
    document.getElementById('notif-pref-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.put('/notifications/preferences', {
          in_app_enabled: true,
          email_enabled: document.getElementById('pref-email').checked,
          push_enabled: document.getElementById('pref-push').checked,
          whatsapp_enabled: document.getElementById('pref-whatsapp').checked,
          sms_enabled: document.getElementById('pref-sms').checked,
          quiet_hours_start: document.getElementById('pref-quiet-start').value || null,
          quiet_hours_end: document.getElementById('pref-quiet-end').value || null,
        });
        window.app.showToast('Preferences updated successfully!', 'success');
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });
  },

  async loadChannelStatus() {
    const slot = document.getElementById('notif-channels-grid');
    try {
      const res = await api.get('/notifications/status');
      const channels = res.channels || {};

      let html = '';
      for (const [name, info] of Object.entries(channels)) {
        const isLive = info.mode === 'LIVE';
        html += `
          <div style="padding:14px; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--bg-surface-alt);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="text-transform:uppercase; font-size:13px;">${name}</strong>
              <span style="font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; background:${isLive ? '#dcfce7' : '#fef3c7'}; color:${isLive ? '#15803d' : '#b45309'};">
                ${info.mode}
              </span>
            </div>
            <div style="font-size:11px; color:var(--text-muted);">${isLive ? 'Ready for live transmission' : 'Simulated logging mode'}</div>
          </div>
        `;
      }
      slot.innerHTML = html;
    } catch (e) {
      console.warn(e);
    }
  },

  async loadPreferences() {
    try {
      const res = await api.get('/notifications/preferences');
      const p = res.preferences || {};
      if (document.getElementById('pref-email')) document.getElementById('pref-email').checked = p.email_enabled ?? true;
      if (document.getElementById('pref-push')) document.getElementById('pref-push').checked = p.push_enabled ?? true;
      if (document.getElementById('pref-whatsapp')) document.getElementById('pref-whatsapp').checked = p.whatsapp_enabled ?? false;
      if (document.getElementById('pref-sms')) document.getElementById('pref-sms').checked = p.sms_enabled ?? false;
      if (p.quiet_hours_start) document.getElementById('pref-quiet-start').value = p.quiet_hours_start.slice(0, 5);
      if (p.quiet_hours_end) document.getElementById('pref-quiet-end').value = p.quiet_hours_end.slice(0, 5);
    } catch (e) {
      console.warn(e);
    }
  },

  async loadNotifications() {
    const slot = document.getElementById('notifications-feed-slot');
    try {
      const res = await api.get('/notifications');
      const notifs = res.notifications || [];

      if (notifs.length === 0) {
        slot.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-muted);">No notifications recorded yet.</div>`;
        return;
      }

      let html = '';
      notifs.forEach(n => {
        const isCritical = n.severity === 'critical';
        const isWarning = n.severity === 'warning';
        const iconClass = isCritical ? 'notif-critical' : isWarning ? 'notif-warning' : 'notif-info';
        const icon = isCritical ? '🚨' : isWarning ? '⚠️' : '🔔';

        html += `
          <div class="notification-item ${!n.is_read ? 'unread' : ''}">
            <div class="notification-icon ${iconClass}">${icon}</div>
            <div style="flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <h4 style="font-size:14px; font-weight:700; color:var(--text-primary);">${n.title}</h4>
                <span style="font-size:11px; color:var(--text-muted);">${new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p style="font-size:13px; color:var(--text-secondary); margin-top:4px; line-height:1.4;">${n.message}</p>
              
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:11px; color:var(--text-muted);">
                <span>Channel Logs: ${n.delivery_logs?.length || 1} delivery attempted</span>
                ${!n.is_read ? `
                  <button class="btn btn-outline btn-sm btn-mark-read" data-id="${n.id}" style="padding:2px 8px; font-size:11px;">
                    Mark as Read
                  </button>
                ` : '<span style="color:var(--emerald-600);">✓ Read</span>'}
              </div>
            </div>
          </div>
        `;
      });

      slot.innerHTML = html;

      // Bind Mark as Read
      document.querySelectorAll('.btn-mark-read').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          await api.post(`/notifications/${id}/read`, {});
          await this.loadNotifications();
        });
      });

    } catch (err) {
      slot.innerHTML = `<div style="color:#ef4444; padding:20px;">Failed to load feed: ${err.message}</div>`;
    }
  },
};

