import { api } from '../api.js';

export const prescriptionsPage = {
  async render() {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>📋</span> Prescription Management</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Securely upload doctor prescriptions, retain revision history, and utilize OCR assistance to populate schedules.
          </p>
        </div>
        <button id="btn-open-upload-pres" class="btn btn-primary">
          + Upload New Prescription
        </button>
      </div>

      <!-- OCR Human Verification Safeguard Banner -->
      <div style="background:#fefce8; border:1px solid #fef08a; border-radius:var(--radius-md); padding:12px 18px; margin-bottom:20px; font-size:12px; color:#854d0e; display:flex; align-items:center; gap:10px;">
        <span style="font-size:16px;">🤖</span>
        <div><strong>OCR & AI Safeguard:</strong> Extracted medicine names and dosages are assistance recommendations only. The system will never automatically activate medicines or modify prescribed dosages without explicit human review and confirmation.</div>
      </div>

      <!-- Prescriptions Grid -->
      <div class="medicines-grid" id="prescriptions-list-slot">
        <div style="text-align:center; padding:40px; color:var(--text-muted);">Loading prescriptions...</div>
      </div>

      <!-- Upload Modal -->
      <div class="modal-backdrop" id="pres-modal">
        <div class="modal-content" style="max-width:580px;">
          <div class="modal-header">
            <h3>Upload Prescription Document</h3>
            <button class="btn-icon" id="btn-close-pres-modal">✕</button>
          </div>
          <form id="pres-form">
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Prescription File (Image or PDF) *</label>
                <input type="file" id="form-pres-file" class="form-control" accept="image/*,.pdf" required />
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Doctor Name</label>
                  <input type="text" id="form-pres-doctor" class="form-control" placeholder="Dr. V. K. Gupta" />
                </div>
                <div class="form-group">
                  <label class="form-label">Prescription Date *</label>
                  <input type="date" id="form-pres-date" class="form-control" value="${new Date().toISOString().split('T')[0]}" required />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Diagnosis / Condition</label>
                <input type="text" id="form-pres-diag" class="form-control" placeholder="Type 2 Diabetes, Hypertension" />
              </div>

              <div class="form-group">
                <label class="form-label">Prescription Notes / Text for OCR Assistance</label>
                <textarea id="form-pres-notes" class="form-control" rows="3" placeholder="e.g. Rx: Metformin 500mg twice daily, Pantoprazole 40mg before breakfast"></textarea>
                <small style="color:var(--text-muted); font-size:11px;">
                  Note: OCR extracts suggested medicines for human review. MediTrack will never alter dosages without explicit user verification.
                </small>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-pres">Cancel</button>
              <button type="submit" class="btn btn-primary">Upload & Process</button>
            </div>
          </form>
        </div>
      </div>
    `;
  },

  async init() {
    const modal = document.getElementById('pres-modal');
    const btnOpen = document.getElementById('btn-open-upload-pres');
    const btnClose = document.getElementById('btn-close-pres-modal');
    const btnCancel = document.getElementById('btn-cancel-pres');
    const form = document.getElementById('pres-form');

    btnOpen?.addEventListener('click', () => {
      form.reset();
      modal.classList.add('active');
    });

    const closeModal = () => modal.classList.remove('active');
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('form-pres-file');
      const file = fileInput.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('prescriptionFile', file);
      formData.append('doctorName', document.getElementById('form-pres-doctor').value);
      formData.append('prescriptionDate', document.getElementById('form-pres-date').value);
      formData.append('diagnosis', document.getElementById('form-pres-diag').value);
      formData.append('notes', document.getElementById('form-pres-notes').value);
      formData.append('patientId', api.getActivePatientId());

      try {
        window.app.showToast('Uploading prescription securely...', 'info');
        await api.upload('/prescriptions/upload', formData);
        window.app.showToast('Prescription uploaded and analyzed!', 'success');
        closeModal();
        await this.loadPrescriptions();
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });

    await this.loadPrescriptions();
  },

  async loadPrescriptions() {
    const slot = document.getElementById('prescriptions-list-slot');
    const patientId = api.getActivePatientId();

    try {
      const res = await api.get('/prescriptions', { patientId });
      const prescriptions = res.prescriptions || [];

      if (prescriptions.length === 0) {
        slot.innerHTML = `
          <div style="grid-column:1/-1; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:40px; text-align:center; color:var(--text-muted);">
            No prescriptions uploaded yet.
          </div>
        `;
        return;
      }

      let html = '';
      prescriptions.forEach(p => {
        const ocrSuggestions = p.ocr_data || [];

        html += `
          <div class="med-card">
            <div>
              <div class="med-card-header">
                <div class="med-icon" style="background:#fef3c7; color:#d97706;">📄</div>
                <span class="status-badge status-taken">${p.status}</span>
              </div>

              <div class="med-details" style="margin-top:14px;">
                <h3>${p.doctor_name ? `Dr. ${p.doctor_name}` : 'Prescription Document'}</h3>
                <p style="font-size:12px; color:var(--text-muted);">Date: ${p.prescription_date} | File: ${p.file_name || 'document'}</p>
                ${p.diagnosis ? `<p style="margin-top:4px;"><strong>Diagnosis:</strong> ${p.diagnosis}</p>` : ''}
                ${p.notes ? `<p style="font-size:12px; color:var(--text-secondary); margin-top:4px;">"${p.notes}"</p>` : ''}

                <!-- OCR Suggestions Preview -->
                ${ocrSuggestions.length > 0 ? `
                  <div style="margin-top:12px; padding:10px; background:var(--bg-surface-alt); border-radius:var(--radius-md); font-size:11px;">
                    <strong style="color:var(--primary-600);">🤖 Detected Medications:</strong>
                    <ul style="padding-left:16px; margin-top:4px;">
                      ${ocrSuggestions.map(s => `<li>${s.name} ${s.dosage}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}
              </div>
            </div>

            <div style="display:flex; gap:8px; margin-top:16px;">
              <button class="btn btn-primary btn-sm btn-view-pres" style="flex:1;" data-id="${p.id}">
                🔒 View Secure Document
              </button>
            </div>
          </div>
        `;
      });

      slot.innerHTML = html;

      // Bind View Document
      document.querySelectorAll('.btn-view-pres').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          try {
            window.app.showToast('Generating secure temporary view link...', 'info');
            const res = await api.get(`/prescriptions/${id}/view-url`);
            if (res.signedUrl) {
              window.open(res.signedUrl, '_blank');
            } else {
              window.app.showToast('Document link generated (simulated private storage path).', 'info');
            }
          } catch (err) {
            window.app.showToast(err.message, 'error');
          }
        });
      });

    } catch (err) {
      slot.innerHTML = `<div style="color:#ef4444; padding:20px;">Failed to load prescriptions: ${err.message}</div>`;
    }
  },
};

