import { api } from '../api.js';

export const medicinesPage = {
  currentStatus: 'active',
  searchQuery: '',

  async render() {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>💊</span> Medicine Management</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Configure prescribed medicines, dosage frequencies, daily intake times, and inventory thresholds.
          </p>
        </div>
        <button id="btn-open-add-med" class="btn btn-primary">
          + Add New Medicine
        </button>
      </div>

      <!-- Medical Disclaimer Banner -->
      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:var(--radius-md); padding:12px 18px; margin-bottom:20px; font-size:12px; color:#1e40af; display:flex; align-items:center; gap:10px;">
        <span style="font-size:16px;">⚕️</span>
        <div><strong>Medical Prescriber Notice:</strong> MediTrack is a tracking tool, not a prescribing system. All medicines and dosages must be manually configured according to a licensed physician's prescription. Do not alter doses without clinical guidance.</div>
      </div>

      <!-- Search & Filters -->
      <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:24px; flex-wrap:wrap;">
        <div class="filter-bar" style="margin-bottom:0;">
          <button class="filter-pill active" data-status="active">Active Medicines</button>
          <button class="filter-pill" data-status="discontinued">Discontinued</button>
          <button class="filter-pill" data-status="all">All Medicines</button>
        </div>

        <div style="max-width:300px; width:100%;">
          <input type="text" id="med-search-input" class="form-control" placeholder="🔍 Search medicines..." />
        </div>
      </div>

      <!-- Medicines Grid -->
      <div class="medicines-grid" id="medicines-list-slot">
        <div style="text-align:center; padding:40px; color:var(--text-muted);">Loading medicines...</div>
      </div>

      <!-- Add/Edit Medicine Modal -->
      <div class="modal-backdrop" id="med-modal">
        <div class="modal-content" style="max-width:640px;">
          <div class="modal-header">
            <h3 id="med-modal-title">Add New Medicine</h3>
            <button class="btn-icon" id="btn-close-med-modal">✕</button>
          </div>
          <form id="med-form">
            <div class="modal-body">
              <input type="hidden" id="form-med-id" />

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Medicine Generic Name *</label>
                  <input type="text" id="form-med-name" class="form-control" placeholder="e.g. Metformin HCl" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Brand Name (Optional)</label>
                  <input type="text" id="form-med-brand" class="form-control" placeholder="e.g. Glycomet SR 500" />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Type *</label>
                  <select id="form-med-type" class="form-select">
                    <option value="tablet">Tablet</option>
                    <option value="capsule">Capsule</option>
                    <option value="syrup">Syrup</option>
                    <option value="injection">Injection</option>
                    <option value="drops">Drops</option>
                    <option value="inhaler">Inhaler</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Prescribed Dosage *</label>
                  <input type="text" id="form-med-dosage" class="form-control" placeholder="e.g. 500mg, 10ml" required />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Food Timing *</label>
                  <select id="form-med-food" class="form-select">
                    <option value="after_food">After Food</option>
                    <option value="before_food">Before Food</option>
                    <option value="with_food">With Food</option>
                    <option value="anytime">Anytime / No restriction</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Units per Intake</label>
                  <input type="number" id="form-med-units" class="form-control" value="1" min="0.5" step="0.5" required />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Initial Stock Available</label>
                  <input type="number" id="form-med-stock" class="form-control" value="30" min="0" />
                </div>
                <div class="form-group">
                  <label class="form-label">Low Stock Threshold</label>
                  <input type="number" id="form-med-threshold" class="form-control" value="7" min="1" />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Daily Scheduled Intake Times (Comma separated, e.g. 08:00, 20:00) *</label>
                <input type="text" id="form-med-times" class="form-control" placeholder="08:00, 20:00" value="08:00" required />
                <small style="color:var(--text-muted); font-size:11px;">Specify in 24-hour format (HH:MM). Multiple doses can be configured.</small>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Prescribing Doctor</label>
                  <input type="text" id="form-med-doctor" class="form-control" placeholder="Dr. V. K. Gupta" />
                </div>
                <div class="form-group">
                  <label class="form-label">Grace Period (Minutes)</label>
                  <input type="number" id="form-med-grace" class="form-control" value="30" min="5" max="180" />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Additional Instructions</label>
                <textarea id="form-med-instructions" class="form-control" rows="2" placeholder="Take with full glass of water. Do not crush."></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-med">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-save-med">Save Medicine</button>
            </div>
          </form>
        </div>
      </div>
    `;
  },

  async init() {
    const modal = document.getElementById('med-modal');
    const btnOpenAdd = document.getElementById('btn-open-add-med');
    const btnClose = document.getElementById('btn-close-med-modal');
    const btnCancel = document.getElementById('btn-cancel-med');
    const form = document.getElementById('med-form');
    const searchInput = document.getElementById('med-search-input');

    btnOpenAdd?.addEventListener('click', () => {
      document.getElementById('med-modal-title').textContent = 'Add New Medicine';
      form.reset();
      document.getElementById('form-med-id').value = '';
      modal.classList.add('active');
    });

    const closeModal = () => modal.classList.remove('active');
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentStatus = e.currentTarget.getAttribute('data-status');
        this.loadMedicines();
      });
    });

    // Search input
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim();
      this.loadMedicines();
    });

    // Form submit
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.saveMedicine();
    });

    await this.loadMedicines();
  },

  async loadMedicines() {
    const slot = document.getElementById('medicines-list-slot');
    const patientId = api.getActivePatientId();

    try {
      const res = await api.get('/medicines', {
        patientId,
        status: this.currentStatus,
        search: this.searchQuery,
      });

      const medicines = res.medicines || [];

      if (medicines.length === 0) {
        slot.innerHTML = `
          <div style="grid-column:1/-1; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:40px; text-align:center; color:var(--text-muted);">
            No medicines found matching this criteria.
          </div>
        `;
        return;
      }

      let html = '';
      medicines.forEach(m => {
        const isDiscontinued = m.status === 'discontinued';
        const inv = Array.isArray(m.medicine_inventory) ? (m.medicine_inventory[0] || {}) : (m.medicine_inventory || {});
        const schedules = m.medication_schedules || [];
        const timesStr = schedules.map(s => s.scheduled_time.slice(0, 5)).join(', ') || 'No schedule';
        const stock = inv.current_stock !== undefined ? inv.current_stock : '--';
        const isLow = inv.current_stock !== undefined && Number(inv.current_stock) <= Number(inv.low_stock_threshold);

        html += `
          <div class="med-card" style="${isDiscontinued ? 'opacity:0.75;' : ''}">
            <div>
              <div class="med-card-header">
                <div class="med-icon">${m.medicine_type === 'syrup' ? '🧴' : m.medicine_type === 'capsule' ? '💊' : '⚪'}</div>
                <span class="status-badge status-${m.status}">${m.status}</span>
              </div>

              <div class="med-details" style="margin-top:14px;">
                <h3>${m.name}</h3>
                ${m.brand_name ? `<p style="font-weight:600; color:var(--primary-600);">${m.brand_name}</p>` : ''}
                <p style="margin-top:4px;"><strong>Dosage:</strong> ${m.prescribed_dosage} (${m.food_timing.replace('_', ' ')})</p>
                <p style="font-size:12px; color:var(--text-muted); margin-top:4px;">🕒 Daily Times: <strong>${timesStr}</strong></p>
                ${m.prescribing_doctor_name ? `<p style="font-size:12px; color:var(--text-muted);">👨‍⚕️ Prescriber: ${m.prescribing_doctor_name}</p>` : ''}
                ${isDiscontinued && m.discontinuation_reason ? `<p style="font-size:12px; color:#b91c1c; margin-top:4px;">Discontinued: "${m.discontinuation_reason}"</p>` : ''}
              </div>
            </div>

            <div>
              <div class="med-stock-status">
                <span>Stock: <strong>${stock}</strong> ${inv.unit_name || 'tablets'}</span>
                ${isLow ? `<span class="stock-tag-low">⚠️ Low Stock</span>` : `<span class="stock-tag-good">OK</span>`}
              </div>

              <div style="display:flex; gap:8px; margin-top:12px;">
                ${!isDiscontinued ? `
                  <button class="btn btn-outline btn-sm btn-edit-med" style="flex:1;" data-id="${m.id}">Edit</button>
                  <button class="btn btn-danger btn-sm btn-discontinue-med" style="flex:1;" data-id="${m.id}">Discontinue</button>
                ` : `
                  <span style="font-size:12px; color:var(--text-muted); text-align:center; width:100%;">Discontinued on ${m.discontinued_at?.split('T')[0] || ''}</span>
                `}
              </div>
            </div>
          </div>
        `;
      });

      slot.innerHTML = html;

      // Bind Edit
      document.querySelectorAll('.btn-edit-med').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          await this.openEditModal(id);
        });
      });

      // Bind Discontinue
      document.querySelectorAll('.btn-discontinue-med').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          this.promptDiscontinue(id);
        });
      });

    } catch (err) {
      slot.innerHTML = `<div style="color:#ef4444; padding:20px;">Failed to load medicines: ${err.message}</div>`;
    }
  },

  async openEditModal(id) {
    try {
      const res = await api.get(`/medicines/${id}`);
      const m = res.medicine;
      const schedules = m.medication_schedules || [];
      const timesStr = schedules.map(s => s.scheduled_time.slice(0, 5)).join(', ');

      document.getElementById('med-modal-title').textContent = 'Edit Medicine';
      document.getElementById('form-med-id').value = m.id;
      document.getElementById('form-med-name').value = m.name;
      document.getElementById('form-med-brand').value = m.brand_name || '';
      document.getElementById('form-med-type').value = m.medicine_type;
      document.getElementById('form-med-dosage').value = m.prescribed_dosage;
      document.getElementById('form-med-food').value = m.food_timing;
      document.getElementById('form-med-units').value = m.units_per_intake;
      document.getElementById('form-med-times').value = timesStr;
      document.getElementById('form-med-doctor').value = m.prescribing_doctor_name || '';
      document.getElementById('form-med-instructions').value = m.additional_instructions || '';

      document.getElementById('med-modal').classList.add('active');
    } catch (err) {
      window.app.showToast(err.message, 'error');
    }
  },

  async saveMedicine() {
    const id = document.getElementById('form-med-id').value;
    const name = document.getElementById('form-med-name').value;
    const brand_name = document.getElementById('form-med-brand').value;
    const medicine_type = document.getElementById('form-med-type').value;
    const prescribed_dosage = document.getElementById('form-med-dosage').value;
    const food_timing = document.getElementById('form-med-food').value;
    const units_per_intake = Number(document.getElementById('form-med-units').value);
    const timesRaw = document.getElementById('form-med-times').value;
    const prescribing_doctor_name = document.getElementById('form-med-doctor').value;
    const additional_instructions = document.getElementById('form-med-instructions').value;
    const initial_stock = Number(document.getElementById('form-med-stock').value || 0);
    const low_stock_threshold = Number(document.getElementById('form-med-threshold').value || 7);
    const grace_period_minutes = Number(document.getElementById('form-med-grace').value || 30);

    const times = timesRaw.split(',').map(t => t.trim()).filter(Boolean);
    const schedules = times.map(t => ({
      scheduled_time: t.length === 5 ? `${t}:00` : t,
      dose_quantity: units_per_intake,
      grace_period_minutes,
    }));

    const payload = {
      name,
      brand_name,
      medicine_type,
      prescribed_dosage,
      food_timing,
      units_per_intake,
      prescribing_doctor_name,
      additional_instructions,
      initial_stock,
      low_stock_threshold,
      schedules,
    };

    try {
      window.app.showToast('Saving medicine...', 'info');
      if (id) {
        await api.put(`/medicines/${id}`, payload);
        window.app.showToast('Medicine updated successfully!', 'success');
      } else {
        await api.post('/medicines', payload);
        window.app.showToast('New medicine added with daily schedules!', 'success');
      }
      document.getElementById('med-modal').classList.remove('active');
      await this.loadMedicines();
    } catch (err) {
      window.app.showToast(err.message, 'error');
    }
  },

  promptDiscontinue(id) {
    const reason = prompt('Please enter doctor or clinical reason for discontinuing this medicine:');
    if (!reason) return;

    api.post(`/medicines/${id}/discontinue`, { reason })
      .then(() => {
        window.app.showToast('Medicine marked as discontinued. Future doses stopped.', 'success');
        this.loadMedicines();
      })
      .catch(err => window.app.showToast(err.message, 'error'));
  },
};

