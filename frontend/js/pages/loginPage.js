import { auth } from '../auth.js';

export const loginPage = {
  render() {
    return `
      <div style="display:flex; align-items:center; justify-content:center; min-height:80vh;">
        <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:var(--radius-xl); padding:40px; width:100%; max-width:440px; box-shadow:var(--shadow-lg);">
          <div style="text-align:center; margin-bottom:28px;">
            <div style="width:54px; height:54px; background:linear-gradient(135deg, var(--primary-600), var(--teal-500)); border-radius:var(--radius-lg); margin:0 auto 16px; display:flex; align-items:center; justify-content:center; color:white; font-size:26px; font-weight:800;">M</div>
            <h2 style="font-size:24px; font-weight:800; color:var(--text-primary);">MediTrack</h2>
            <p style="font-size:14px; color:var(--text-muted); margin-top:4px;">Smart Medicine Management & Adherence</p>
          </div>

          <div style="display:flex; border-bottom:1px solid var(--border-color); margin-bottom:24px;">
            <button id="tab-login-btn" style="flex:1; padding:12px; font-weight:600; font-size:14px; border-bottom:2px solid var(--primary-600); color:var(--primary-600);">Sign In</button>
            <button id="tab-register-btn" style="flex:1; padding:12px; font-weight:600; font-size:14px; border-bottom:2px solid transparent; color:var(--text-secondary);">Register</button>
          </div>

          <!-- Sign In Form -->
          <form id="login-form">
            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input type="email" id="login-email" class="form-control" placeholder="you@example.com" required value="patient@meditrack.local" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" id="login-password" class="form-control" placeholder="••••••••" required value="Password@123" />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:10px;">Sign In</button>

            <!-- Quick Demo Fill -->
            <div style="margin-top:20px; padding:12px; background:var(--bg-surface-alt); border-radius:var(--radius-md); font-size:12px;">
              <p style="font-weight:600; margin-bottom:6px; color:var(--text-secondary);">Testing Demo Accounts (Sandbox Only):</p>
              <div style="display:flex; gap:8px;">
                <button type="button" id="btn-fill-patient" class="btn btn-secondary btn-sm" style="flex:1;">👤 Demo Patient</button>
                <button type="button" id="btn-fill-caretaker" class="btn btn-secondary btn-sm" style="flex:1;">🛡️ Demo Caretaker</button>
              </div>
              <p style="font-size:11px; color:var(--text-muted); margin-top:6px;">For real usage, please switch to the <strong>Register</strong> tab to create your own secure personal account.</p>
            </div>
          </form>

          <!-- Register Form (Hidden by default) -->
          <form id="register-form" style="display:none;">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input type="text" id="reg-name" class="form-control" placeholder="John Doe" required />
            </div>
            <div class="form-group">
              <label class="form-label">Email Address</label>
              <input type="email" id="reg-email" class="form-control" placeholder="john@example.com" required />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" id="reg-password" class="form-control" placeholder="At least 6 characters" required />
            </div>
            <div class="form-group">
              <label class="form-label">Role</label>
              <select id="reg-role" class="form-select">
                <option value="patient">Patient (Manage medicines & take doses)</option>
                <option value="caretaker">Caretaker (Monitor family member adherence)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Phone Number (Optional)</label>
              <input type="tel" id="reg-phone" class="form-control" placeholder="+91 98765 43210" />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:10px;">Create Account</button>
          </form>
        </div>
      </div>
    `;
  },

  init() {
    const tabLogin = document.getElementById('tab-login-btn');
    const tabRegister = document.getElementById('tab-register-btn');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    tabLogin.addEventListener('click', () => {
      tabLogin.style.borderBottomColor = 'var(--primary-600)';
      tabLogin.style.color = 'var(--primary-600)';
      tabRegister.style.borderBottomColor = 'transparent';
      tabRegister.style.color = 'var(--text-secondary)';
      loginForm.style.display = 'block';
      registerForm.style.display = 'none';
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.style.borderBottomColor = 'var(--primary-600)';
      tabRegister.style.color = 'var(--primary-600)';
      tabLogin.style.borderBottomColor = 'transparent';
      tabLogin.style.color = 'var(--text-secondary)';
      loginForm.style.display = 'none';
      registerForm.style.display = 'block';
    });

    // Quick demo fills
    document.getElementById('btn-fill-patient')?.addEventListener('click', () => {
      document.getElementById('login-email').value = 'patient@meditrack.local';
      document.getElementById('login-password').value = 'Password@123';
    });

    document.getElementById('btn-fill-caretaker')?.addEventListener('click', () => {
      document.getElementById('login-email').value = 'caretaker@meditrack.local';
      document.getElementById('login-password').value = 'Password@123';
    });

    // Submit login
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const pass = document.getElementById('login-password').value;

      try {
        window.app.showToast('Signing in...', 'info');
        await auth.login(email, pass);
        window.app.showToast('Login successful!', 'success');
        window.location.hash = '#dashboard';
        window.location.reload();
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });

    // Submit register
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('reg-name').value;
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      const role = document.getElementById('reg-role').value;
      const phone = document.getElementById('reg-phone').value;

      try {
        window.app.showToast('Creating account...', 'info');
        await auth.register({ fullName, email, password, role, phone });
        window.app.showToast('Registration successful!', 'success');
        window.location.hash = '#dashboard';
        window.location.reload();
      } catch (err) {
        window.app.showToast(err.message, 'error');
      }
    });
  },
};

