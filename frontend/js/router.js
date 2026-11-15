import { auth } from './auth.js';
import { loginPage } from './pages/loginPage.js';
import { dashboardPage } from './pages/dashboardPage.js';
import { schedulePage } from './pages/schedulePage.js';
import { medicinesPage } from './pages/medicinesPage.js';
import { inventoryPage } from './pages/inventoryPage.js';
import { analyticsPage } from './pages/analyticsPage.js';
import { calendarPage } from './pages/calendarPage.js';
import { prescriptionsPage } from './pages/prescriptionsPage.js';
import { caretakersPage } from './pages/caretakersPage.js';
import { notificationsPage } from './pages/notificationsPage.js';
import { profilePage } from './pages/profilePage.js';

const routes = {
  login: loginPage,
  dashboard: dashboardPage,
  schedule: schedulePage,
  medicines: medicinesPage,
  inventory: inventoryPage,
  analytics: analyticsPage,
  calendar: calendarPage,
  prescriptions: prescriptionsPage,
  caretakers: caretakersPage,
  notifications: notificationsPage,
  settings: notificationsPage, // maps to notifications & preferences settings
  profile: profilePage,
};

export const router = {
  async navigate() {
    let hash = window.location.hash.slice(1).toLowerCase() || 'dashboard';

    // Auth guard
    if (!auth.isAuthenticated()) {
      hash = 'login';
    } else if (hash === 'login') {
      hash = 'dashboard';
    }

    const page = routes[hash] || dashboardPage;
    const contentSlot = document.getElementById('main-content-slot');
    const sidebar = document.getElementById('main-sidebar');
    const topHeader = document.getElementById('main-header');

    // If login view, hide sidebar and header
    if (hash === 'login') {
      if (sidebar) sidebar.style.display = 'none';
      if (topHeader) topHeader.style.display = 'none';
      if (document.querySelector('.main-wrapper')) {
        document.querySelector('.main-wrapper').style.marginLeft = '0';
      }
    } else {
      if (sidebar) sidebar.style.display = 'flex';
      if (topHeader) topHeader.style.display = 'flex';
      if (document.querySelector('.main-wrapper')) {
        document.querySelector('.main-wrapper').style.marginLeft = '';
      }
    }

    // Update active nav link
    document.querySelectorAll('.nav-item').forEach(item => {
      const pageKey = item.getAttribute('data-page');
      if (pageKey === hash) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update header title
    const headerTitle = document.getElementById('header-page-title');
    if (headerTitle) {
      headerTitle.textContent = hash.charAt(0).toUpperCase() + hash.slice(1);
    }

    // Render page
    if (contentSlot) {
      contentSlot.innerHTML = await page.render();
      if (typeof page.init === 'function') {
        await page.init();
      }
    }
  },

  init() {
    window.addEventListener('hashchange', () => this.navigate());
    this.navigate();
  },
};

