import { api } from '../api.js';

export const inventoryPage = {
  async render() {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title"><span>📦</span> Medicine Inventory & Stock Tracking</h2>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">
            Automatic stock deduction upon dose confirmation, refill management, and estimated supply calculations.
          </p>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Total Medicines</span>
            <div class="stat-icon" style="background:#e0f2fe; color:#0284c7;">📦</div>
          </div>
          <div class="stat-value" id="inv-stat-total">--</div>
          <div class="stat-footer">Tracked in inventory</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Low Stock</span>
            <div class="stat-icon" style="background:#fef3c7; color:#d97706;">⚠️</div>
          </div>
          <div class="stat-value" id="inv-stat-low" style="color:#d97706;">--</div>
          <div class="stat-footer">Below threshold</div>
        </div>

        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">Out of Stock</span>
            <div class="stat-icon" style="background:#fee2e2; color:#dc2626;">🚨</div>
          </div>
          <div class="stat-value" id="inv-stat-out" style="color:#dc2626;">--</div>
          <div class="stat-footer">Refill immediately</div>
        </div>
      </div>

      <!-- Inventory Table -->
      <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:24px; margin-bottom:32px;">
        <h3 style="font-size:16px; font-weight:700; margin-bottom:16px;">Current Stock & Supply Projections</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Medicine Name</th>
                <th>Dosage & Type</th>
                <th>Available Stock</th>
                <th>Est. Daily Use</th>
                <th>Supply Remaining</th>
                <th>Threshold</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="inventory-table-body">
              <tr><td colspan="7" style="text-align:center; padding:30px;">Loading inventory...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Inventory Transactions History -->
      <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-lg); padding:24px;">
        <h3 style="font-size:16px; font-weight:700; margin-bottom:16px;">Recent Stock Transactions (Dose Deductions & Refills)</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Medicine</th>
                <th>Type</th>
                <th>Change</th>
                <th>Balance After</th>
                <th>Reference / Reason</th>
              </tr>
            </thead>
            <tbody id="transactions-table-body">
              <tr><td colspan="6" style="text-align:center; padding:30px;">Loading transactions...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Refill Modal -->
      <div class="modal-backdrop" id="refill-modal">
        <div class="modal-content" style="max-width:480px;">
          <div class="modal-header">
            <h3>Refill Medicine Stock</h3>
            <button class="btn-icon" id="btn-close-refill-modal">✕</button>
          </div>
          <form id="refill-form">
            <div class="modal-body">
              <input type="hidden" id="refill-med-id" />
              <div class="form-group">
                <label class="form-label">Medicine</label>
                <input type="text" id="refill-med-name" class="form-control" readonly style="background:var(--bg-surface-alt);" />
              </div>
              <div class="form-group">
                <label class="form-label">Quantity to Add *</label>
                <input type="number" id="refill-qty" class="form-control" min="1" value="30" required />
              </div>
              <div class="form-group">
                <label class="form-label">Update Low-Stock Alert Threshold (Optional)</label>
                <input type="number" id="refill-threshold" class="form-control" min="1" placeholder="Leave empty to keep current" />
              </div>
              <div class="form-group">
                <label class="form-label">Refill Notes</label>
                <input type="text" id="refill-note" class="form-control" placeholder="Purchased 1 strip / bottle from pharmacy" />
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-refill">Cancel</button>
              <button type="submit" class="btn btn-primary">Confirm Refill</button>
            </div>
          </form>
        </div>
      </div>
    `;
  },

  async init() {
    const modal = document.getElementById('refill-modal');
    const btnClose = document.getElementById('btn-close-refill-modal');
    const btnCancel = document.getElementById('btn-cancel-refill');
    const refillForm = document.getElementById('refill-form');

    const closeModal = () => modal.classList.remove('active');
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    refillForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const medicineId = document.getElementById('refill-med-id').value;
      const quantity = Number(document.getElementById('refill-qty').value);
      const note = document.getElementById('refill-note').value;
      const newThreshold = document.getElementById('refill-threshold').value;

      try {
        window.app.showToast('Adding stock refill...', 'info');
        await api.post('/inventory/refill', {
          medicineId,
          quantity,
          note,
          newThreshold: newThreshold ? Number(newThreshold) : undefined,
        });
        window.app.showToast('Stock refilled successfully!', 'success');
        closeModal();
        await this.loadInventory();
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });

    await this.loadInventory();
  },

  async loadInventory() {
    const tableBody = document.getElementById('inventory-table-body');
    const txBody = document.getElementById('transactions-table-body');
    const patientId = api.getActivePatientId();

    try {
      const res = await api.get('/inventory', { patientId });
      const { summary, inventory, recentTransactions } = res;

      document.getElementById('inv-stat-total').textContent = summary.totalMedicines;
      document.getElementById('inv-stat-low').textContent = summary.lowStockCount;
      document.getElementById('inv-stat-out').textContent = summary.outOfStockCount;

      if (!inventory || inventory.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No inventory records found.</td></tr>`;
      } else {
        let html = '';
        inventory.forEach(item => {
          const med = item.medicines || {};
          const isLow = item.isLowStock;
          const isOut = item.isOutOfStock;

          let badgeHtml = '';
          if (isOut) {
            badgeHtml = `<span class="stock-tag-low" style="background:#fee2e2; color:#b91c1c;">Out of Stock</span>`;
          } else if (isLow) {
            badgeHtml = `<span class="stock-tag-low">~${item.estimatedRemainingDays} days left</span>`;
          } else {
            badgeHtml = `<span class="stock-tag-good">~${item.estimatedRemainingDays} days left</span>`;
          }

          html += `
            <tr>
              <td>
                <strong>${med.name || 'Medicine'}</strong>
                ${med.brand_name ? `<div style="font-size:12px; color:var(--text-muted);">${med.brand_name}</div>` : ''}
              </td>
              <td>${med.prescribed_dosage || ''} (${med.medicine_type || 'tablet'})</td>
              <td>
                <span style="font-size:16px; font-weight:700; color:${isLow ? '#dc2626' : 'var(--text-primary)'};">${item.current_stock}</span>
                <span style="font-size:12px; color:var(--text-muted);">${item.unit_name}</span>
              </td>
              <td>${Number(item.dailyConsumption).toFixed(1)} / day</td>
              <td>${badgeHtml}</td>
              <td>${item.low_stock_threshold} ${item.unit_name}</td>
              <td style="text-align:right;">
                <button class="btn btn-secondary btn-sm btn-open-refill" data-id="${item.medicine_id}" data-name="${med.name}" data-thresh="${item.low_stock_threshold}">
                  + Refill
                </button>
              </td>
            </tr>
          `;
        });
        tableBody.innerHTML = html;

        // Bind Refill buttons
        document.querySelectorAll('.btn-open-refill').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const medId = e.currentTarget.getAttribute('data-id');
            const medName = e.currentTarget.getAttribute('data-name');
            const thresh = e.currentTarget.getAttribute('data-thresh');

            document.getElementById('refill-med-id').value = medId;
            document.getElementById('refill-med-name').value = medName;
            document.getElementById('refill-threshold').value = thresh;
            document.getElementById('refill-modal').classList.add('active');
          });
        });
      }

      // Render transactions
      if (!recentTransactions || recentTransactions.length === 0) {
        txBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">No transactions recorded yet.</td></tr>`;
      } else {
        let txHtml = '';
        recentTransactions.forEach(tx => {
          const isDeduction = tx.quantity_change < 0;
          const medName = tx.medicines?.name || 'Medicine';
          txHtml += `
            <tr>
              <td>${new Date(tx.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td><strong>${medName}</strong></td>
              <td><span class="status-badge ${isDeduction ? 'status-pending' : 'status-taken'}">${tx.transaction_type.replace('_', ' ')}</span></td>
              <td style="font-weight:700; color:${isDeduction ? '#dc2626' : '#16a34a'};">${tx.quantity_change > 0 ? `+${tx.quantity_change}` : tx.quantity_change}</td>
              <td><strong>${tx.balance_after}</strong></td>
              <td style="color:var(--text-secondary);">${tx.reference_note || '--'}</td>
            </tr>
          `;
        });
        txBody.innerHTML = txHtml;
      }

    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="7" style="color:#ef4444; padding:20px;">Failed to load inventory: ${err.message}</td></tr>`;
    }
  },
};

