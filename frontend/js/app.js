import { auth } from './auth.js';
import { api } from './api.js';
import { router } from './router.js';

class App {
  constructor() {
    this.toastContainer = null;
  }

  init() {
    this.toastContainer = document.getElementById('toast-container');
    this.initTheme();
    this.initUserUI();
    this.initNotificationPolling();
    router.init();

    // Logout button
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      auth.logout();
    });

    // Theme toggle button
    document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
      this.toggleTheme();
    });

    // Mobile menu toggle
    const menuBtn = document.getElementById('btn-toggle-menu');
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    menuBtn?.addEventListener('click', () => {
      sidebar?.classList.toggle('mobile-open');
      backdrop?.classList.toggle('active');
    });

    backdrop?.addEventListener('click', () => {
      sidebar?.classList.remove('mobile-open');
      backdrop?.classList.remove('active');
    });

    // Close mobile menu on nav link clicks
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
      item.addEventListener('click', () => {
        sidebar?.classList.remove('mobile-open');
        backdrop?.classList.remove('active');
      });
    });
  }

  initTheme() {
    const savedTheme = localStorage.getItem('meditrack_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('meditrack_theme', next);
    this.showToast(`Switched to ${next} mode`, 'info');
  }

  initUserUI() {
    const user = auth.getUser();
    if (!user) return;

    const nameEl = document.getElementById('sidebar-user-name');
    const roleEl = document.getElementById('sidebar-user-role');
    const avatarEl = document.getElementById('sidebar-user-avatar');

    if (nameEl) nameEl.textContent = user.full_name || user.email;
    if (roleEl) roleEl.textContent = user.role || 'Patient';
    if (avatarEl) {
      const initial = (user.full_name || user.email || 'M').charAt(0).toUpperCase();
      avatarEl.textContent = initial;
    }
  }

  showToast(message, type = 'info') {
    if (!this.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `
      <span style="font-weight:700;">${icon}</span>
      <span style="font-size:13px; flex:1;">${message}</span>
    `;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  initNotificationPolling() {
    // Check for unread alerts every 30 seconds
    setInterval(async () => {
      if (!auth.isAuthenticated()) return;
      try {
        const res = await api.get('/notifications');
        const notifs = res.notifications || [];
        const unreadCount = notifs.filter(n => !n.is_read).length;

        const badgeDot = document.getElementById('notif-badge-dot');
        if (badgeDot) {
          badgeDot.style.display = unreadCount > 0 ? 'block' : 'none';
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 30000);
  }
}

window.app = new App();
document.addEventListener('DOMContentLoaded', () => window.app.init());

