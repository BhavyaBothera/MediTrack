import { api } from '../api.js';

export const caretakersPage = {
  async render() {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>🛡️</span> Multiple Caretaker & Family Monitoring</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Authorize family members or caretakers to receive automated overdue medication alerts and oversee adherence.
          </p>
        </div>
        <div style="display:flex; gap:10px;">
          <button id="btn-open-accept-invite" class="btn btn-secondary btn-sm">Join via Invite Token</button>
          <button id="btn-open-invite-caretaker" class="btn btn-primary btn-sm">+ Invite New Caretaker</button>
        </div>
      </div>

      <!-- Caretakers List -->
      <div class="medicines-grid" id="caretakers-list-slot">
        <div style="text-align:center; padding:40px; color:var(--text-muted);">Loading caretakers...</div>
      </div>

      <!-- Invite Caretaker Modal -->
      <div class="modal-backdrop" id="invite-modal">
        <div class="modal-content" style="max-width:580px;">
          <div class="modal-header">
            <h3>Invite Caretaker / Family Member</h3>
            <button class="btn-icon" id="btn-close-invite-modal">✕</button>
          </div>
          <form id="invite-form">
            <div class="modal-body">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Caretaker Email Address *</label>
                  <input type="email" id="form-c-email" class="form-control" placeholder="daughter@example.com" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Phone Number (For WhatsApp / SMS)</label>
                  <input type="tel" id="form-c-phone" class="form-control" placeholder="+91 98765 43211" />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Relationship</label>
                  <input type="text" id="form-c-relation" class="form-control" placeholder="Daughter, Son, Nurse, Guardian" value="Family Member" />
                </div>
                <div class="form-group">
                  <label class="form-label">Permission Level *</label>
                  <select id="form-c-level" class="form-select">
                    <option value="primary">Primary Caretaker (All critical alerts)</option>
                    <option value="secondary">Secondary Caretaker (Escalation alerts)</option>
                    <option value="read_only">Read-Only (Monitoring only)</option>
                  </select>
                </div>
              </div>

              <div style="background:var(--bg-surface-alt); padding:16px; border-radius:var(--radius-md); margin-top:12px;">
                <label class="form-label" style="margin-bottom:10px;">Alert & Action Permissions</label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px;">
                  <label style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="perm-overdue" checked /> Receive Overdue Alerts
                  </label>
                  <label style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="perm-stock" checked /> Receive Low Stock Alerts
                  </label>
                  <label style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="perm-confirm" checked /> Can Confirm Doses
                  </label>
                  <label style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="perm-edit" /> Can Edit Medicines
                  </label>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-invite">Cancel</button>
              <button type="submit" class="btn btn-primary">Send Caretaker Invitation</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Accept Token Modal -->
      <div class="modal-backdrop" id="accept-modal">
        <div class="modal-content" style="max-width:440px;">
          <div class="modal-header">
            <h3>Accept Patient Invitation</h3>
            <button class="btn-icon" id="btn-close-accept-modal">✕</button>
          </div>
          <form id="accept-form">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Invitation Token</label>
                <input type="text" id="accept-token-input" class="form-control" placeholder="Enter invitation token" required />
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-accept">Cancel</button>
              <button type="submit" class="btn btn-primary">Accept & Link Patient</button>
            </div>
          </form>
        </div>
      </div>
    `;
  },

  async init() {
    const inviteModal = document.getElementById('invite-modal');
    const acceptModal = document.getElementById('accept-modal');

    document.getElementById('btn-open-invite-caretaker')?.addEventListener('click', () => {
      document.getElementById('invite-form').reset();
      inviteModal.classList.add('active');
    });

    document.getElementById('btn-open-accept-invite')?.addEventListener('click', () => {
      document.getElementById('accept-form').reset();
      acceptModal.classList.add('active');
    });

    document.getElementById('btn-close-invite-modal')?.addEventListener('click', () => inviteModal.classList.remove('active'));
    document.getElementById('btn-cancel-invite')?.addEventListener('click', () => inviteModal.classList.remove('active'));
    document.getElementById('btn-close-accept-modal')?.addEventListener('click', () => acceptModal.classList.remove('active'));
    document.getElementById('btn-cancel-accept')?.addEventListener('click', () => acceptModal.classList.remove('active'));

    // Submit invite
    document.getElementById('invite-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inviteEmail = document.getElementById('form-c-email').value;
      const invitePhone = document.getElementById('form-c-phone').value;
      const relationshipType = document.getElementById('form-c-relation').value;
      const permissionLevel = document.getElementById('form-c-level').value;
      const canReceiveOverdueAlerts = document.getElementById('perm-overdue').checked;
      const canReceiveStockAlerts = document.getElementById('perm-stock').checked;
      const canConfirmDoses = document.getElementById('perm-confirm').checked;
      const canEditMedicines = document.getElementById('perm-edit').checked;

      try {
        window.app.showToast('Sending invitation...', 'info');
        await api.post('/caretakers/invite', {
          inviteEmail,
          invitePhone,
          relationshipType,
          permissionLevel,
          canReceiveOverdueAlerts,
          canReceiveStockAlerts,
          canConfirmDoses,
          canEditMedicines,
        });
        window.app.showToast('Caretaker invitation created!', 'success');
        inviteModal.classList.remove('active');
        await this.loadCaretakers();
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });

    // Submit accept
    document.getElementById('accept-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inviteToken = document.getElementById('accept-token-input').value.trim();
      try {
        window.app.showToast('Linking patient account...', 'info');
        await api.post('/caretakers/accept', { inviteToken });
        window.app.showToast('Successfully linked! You now have caretaker access.', 'success');
        acceptModal.classList.remove('active');
        window.location.hash = '#dashboard';
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });

    await this.loadCaretakers();
  },

  async loadCaretakers() {
    const slot = document.getElementById('caretakers-list-slot');

    try {
      const res = await api.get('/caretakers');
      const caretakers = res.caretakers || [];

      if (caretakers.length === 0) {
        slot.innerHTML = `
          <div style="grid-column:1/-1; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:40px; text-align:center; color:var(--text-muted);">
            No caretakers authorized yet. Click "+ Invite New Caretaker" to designate a family member.
          </div>
        `;
        return;
      }

      let html = '';
      caretakers.forEach(c => {
        const isRevoked = c.status === 'revoked';
        const isAccepted = c.status === 'accepted';
        const caretakerProfile = c.caretaker || {};
        const perms = c.caretaker_permissions?.[0] || {};

        html += `
          <div class="med-card" style="${isRevoked ? 'opacity:0.6;' : ''}">
            <div>
              <div class="med-card-header">
                <div class="med-icon" style="background:#e0f2fe; color:#0284c7;">🛡️</div>
                <span class="status-badge status-${isAccepted ? 'taken' : isRevoked ? 'missed' : 'pending'}">${c.status}</span>
              </div>

              <div class="med-details" style="margin-top:14px;">
                <h3>${caretakerProfile.full_name || c.invite_email}</h3>
                <p style="font-weight:600; color:var(--primary-600);">${c.relationship_type}</p>
                <p style="font-size:12px; color:var(--text-muted); margin-top:4px;">Email: ${c.invite_email}</p>
                ${c.invite_phone ? `<p style="font-size:12px; color:var(--text-muted);">Phone: ${c.invite_phone}</p>` : ''}

                <div style="margin-top:12px; padding:10px; background:var(--bg-surface-alt); border-radius:var(--radius-md); font-size:11px;">
                  <strong>Permission:</strong> ${perms.permission_level?.toUpperCase() || 'PRIMARY'}
                  <div style="margin-top:4px; color:var(--text-secondary);">
                    ${perms.can_receive_overdue_alerts ? '✓ Overdue Alerts ' : ''}
                    ${perms.can_receive_stock_alerts ? '✓ Stock Alerts ' : ''}
                    ${perms.can_confirm_doses ? '✓ Can Confirm Doses' : ''}
                  </div>
                </div>

                ${c.status === 'pending' ? `
                  <div style="margin-top:8px; font-size:11px; color:#d97706; word-break:break-all;">
                    Invite Token: <code>${c.invite_token}</code>
                  </div>
                ` : ''}
              </div>
            </div>

            <div>
              ${!isRevoked ? `
                <button class="btn btn-danger btn-sm btn-revoke-caretaker" style="width:100%;" data-id="${c.id}">
                  Revoke Access
                </button>
              ` : `
                <span style="font-size:12px; color:#dc2626; text-align:center; display:block;">Access Revoked</span>
              `}
            </div>
          </div>
        `;
      });

      slot.innerHTML = html;

      // Bind Revoke
      document.querySelectorAll('.btn-revoke-caretaker').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          if (!confirm('Are you sure you want to revoke this caretaker access? They will immediately lose access to all patient medical records.')) return;

          try {
            await api.post(`/caretakers/${id}/revoke`, {});
            window.app.showToast('Caretaker access revoked immediately.', 'success');
            await this.loadCaretakers();
          } catch (err) {
            window.app.showToast(err.message, 'error');
          }
        });
      });

    } catch (err) {
      slot.innerHTML = `<div style="color:#ef4444; padding:20px;">Failed to load caretakers: ${err.message}</div>`;
    }
  },
};

