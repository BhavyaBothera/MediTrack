import { api } from '../api.js';

export const profilePage = {
  async render() {
    const user = api.getUser();
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>👤</span> User Profile & Emergency Contacts</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Manage your personal profile details, configured timezone, and primary emergency contact.
          </p>
        </div>
      </div>

      <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:32px; max-width:680px;">
        <form id="profile-form">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Full Name *</label>
              <input type="text" id="prof-name" class="form-control" value="${user?.full_name || ''}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input type="email" id="prof-email" class="form-control" value="${user?.email || ''}" disabled style="background:var(--bg-surface-alt);" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Phone Number</label>
              <input type="tel" id="prof-phone" class="form-control" value="${user?.phone || ''}" placeholder="+91 98765 43210" />
            </div>
            <div class="form-group">
              <label class="form-label">Timezone *</label>
              <select id="prof-tz" class="form-select">
                <option value="Asia/Kolkata" selected>Asia/Kolkata (IST - Default)</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
              </select>
            </div>
          </div>

          <h3 style="font-size:15px; font-weight:700; margin:20px 0 12px; color:var(--text-primary);">Emergency Contact Details</h3>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Contact Person Name</label>
              <input type="text" id="prof-emg-name" class="form-control" value="${user?.emergency_contact_name || ''}" placeholder="Ananya Sharma (Daughter)" />
            </div>
            <div class="form-group">
              <label class="form-label">Contact Person Phone</label>
              <input type="tel" id="prof-emg-phone" class="form-control" value="${user?.emergency_contact_phone || ''}" placeholder="+91 98765 43211" />
            </div>
          </div>

          <div style="margin-top:24px; display:flex; justify-content:flex-end;">
            <button type="submit" class="btn btn-primary">Save Profile Changes</button>
          </div>
        </form>
      </div>
    `;
  },

  async init() {
    const form = document.getElementById('profile-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('prof-name').value;
      const phone = document.getElementById('prof-phone').value;
      const timezone = document.getElementById('prof-tz').value;
      const emergencyContactName = document.getElementById('prof-emg-name').value;
      const emergencyContactPhone = document.getElementById('prof-emg-phone').value;

      try {
        window.app.showToast('Updating profile...', 'info');
        const res = await api.put('/auth/profile', {
          fullName,
          phone,
          timezone,
          emergencyContactName,
          emergencyContactPhone,
        });
        if (res.profile) {
          api.setSession(api.getToken(), res.profile);
        }
        window.app.showToast('Profile updated successfully!', 'success');
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });
  },
};

