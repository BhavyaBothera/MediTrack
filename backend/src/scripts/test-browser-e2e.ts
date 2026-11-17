import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function runBrowserAcceptanceTests() {
  console.log('========================================================================');
  console.log(' MEDITRACK – REAL BROWSER AUTOMATION & VISUAL ACCEPTANCE TEST SUITE');
  console.log('========================================================================\n');

  const screenshotsDir = path.resolve(__dirname, '../../../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];

  console.log('Launching Google Chrome browser via Playwright...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  try {
    // -------------------------------------------------------------------------
    // 1. DESKTOP VIEWPORT TESTING (1280 x 800)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. DESKTOP VIEWPORT SUITE (1280 x 800) ---');
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await desktopContext.newPage();

    // Listen to console errors and network failures
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.warn(`[Browser Console Error] ${msg.text()}`);
        consoleErrors.push(msg.text());
      }
    });

    page.on('requestfailed', req => {
      const failure = `${req.method()} ${req.url()}: ${req.failure()?.errorText}`;
      console.warn(`[Network Request Failed] ${failure}`);
      networkFailures.push(failure);
    });

    // 1.1 Login Page
    console.log('[Browser] Navigating to Login Page (#login)...');
    await page.goto('http://localhost:5000/#login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const loginScreenshot = path.join(screenshotsDir, 'desktop_01_login.png');
    await page.screenshot({ path: loginScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(loginScreenshot)}`);

    // 1.2 Perform Login as Patient
    console.log('[Browser] Entering patient login credentials...');
    await page.fill('#login-email', 'patient@meditrack.local');
    await page.fill('#login-password', 'Password@123');
    await page.click('#login-form button[type="submit"]');

    // Wait for Dashboard to render
    console.log('[Browser] Waiting for dashboard navigation...');
    await page.waitForSelector('#main-sidebar', { timeout: 8000 });
    await page.waitForSelector('#stat-total', { timeout: 8000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('stat-total');
      return el && el.textContent && el.textContent.trim() !== '--' && !el.querySelector('.skeleton-shimmer');
    }, { timeout: 15000 }).catch(() => console.log('Timeout waiting for stat-total populate'));
    await page.waitForTimeout(1000);

    // 1.3 Dashboard Page
    console.log('[Browser] Capturing Dashboard Page (#dashboard)...');
    const dashScreenshot = path.join(screenshotsDir, 'desktop_02_dashboard.png');
    await page.screenshot({ path: dashScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(dashScreenshot)}`);

    // 1.4 Today's Schedule Page
    console.log('[Browser] Navigating to Today Schedule (#schedule)...');
    await page.click('a[href="#schedule"]');
    await page.waitForSelector('#schedule-doses-list', { timeout: 5000 });
    await page.waitForTimeout(1000);
    const schedScreenshot = path.join(screenshotsDir, 'desktop_03_schedule.png');
    await page.screenshot({ path: schedScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(schedScreenshot)}`);

    // 1.5 Medicines Page & Add Modal
    console.log('[Browser] Navigating to Medicines Page (#medicines)...');
    await page.click('a[href="#medicines"]');
    await page.waitForSelector('.medicines-grid', { timeout: 5000 });
    await page.waitForFunction(() => {
      const stock = document.querySelector('.med-stock-status');
      return stock && stock.textContent && !stock.textContent.includes('--');
    }, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const medsScreenshot = path.join(screenshotsDir, 'desktop_04_medicines.png');
    await page.screenshot({ path: medsScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(medsScreenshot)}`);

    // Open Add Medicine Modal
    console.log('[Browser] Testing Add Medicine Modal interaction...');
    await page.click('#btn-open-add-med');
    await page.waitForSelector('#med-modal.active', { timeout: 3000 });
    await page.waitForTimeout(500);
    const addMedModalScreenshot = path.join(screenshotsDir, 'desktop_04b_add_medicine_modal.png');
    await page.screenshot({ path: addMedModalScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(addMedModalScreenshot)}`);
    // Close modal
    await page.click('#btn-close-med-modal');
    await page.waitForTimeout(500);

    // 1.6 Inventory Page
    console.log('[Browser] Navigating to Inventory Page (#inventory)...');
    await page.click('a[href="#inventory"]');
    await page.waitForSelector('.data-table', { timeout: 5000 });
    await page.waitForTimeout(1000);
    const invScreenshot = path.join(screenshotsDir, 'desktop_05_inventory.png');
    await page.screenshot({ path: invScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(invScreenshot)}`);

    // Test Refill Modal if medicines exist
    const refillBtn = await page.$('.btn-refill');
    if (refillBtn) {
      console.log('[Browser] Testing Refill Stock Modal interaction...');
      await refillBtn.click();
      await page.waitForSelector('#refill-modal.active', { timeout: 3000 });
      await page.waitForTimeout(500);
      const refillModalScreenshot = path.join(screenshotsDir, 'desktop_05b_refill_modal.png');
      await page.screenshot({ path: refillModalScreenshot, fullPage: false });
      console.log(`✓ Screenshot captured: ${path.basename(refillModalScreenshot)}`);
      await page.click('#btn-close-refill-modal');
      await page.waitForTimeout(500);
    }

    // 1.7 Analytics & Reports Page
    console.log('[Browser] Navigating to Analytics & Reports Page (#analytics)...');
    await page.click('a[href="#analytics"]');
    await page.waitForSelector('.stats-grid', { timeout: 5000 });
    await page.waitForTimeout(1000);
    const anaScreenshot = path.join(screenshotsDir, 'desktop_06_analytics.png');
    await page.screenshot({ path: anaScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(anaScreenshot)}`);

    // Test filter pill click
    const filterPill7d = await page.$('button[data-days="7"]');
    if (filterPill7d) {
      console.log('[Browser] Testing Analytics filter interaction ("Last 7 Days")...');
      await filterPill7d.click();
      await page.waitForTimeout(500);
    }

    // 1.8 Calendar Page
    console.log('[Browser] Navigating to Calendar View (#calendar)...');
    await page.click('a[href="#calendar"]');
    await page.waitForSelector('.calendar-grid', { timeout: 5000 });
    await page.waitForTimeout(1000);
    const calScreenshot = path.join(screenshotsDir, 'desktop_07_calendar.png');
    await page.screenshot({ path: calScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(calScreenshot)}`);

    // 1.9 Prescriptions Page
    console.log('[Browser] Navigating to Prescriptions Page (#prescriptions)...');
    await page.click('a[href="#prescriptions"]');
    await page.waitForSelector('.medicines-grid', { timeout: 5000 });
    await page.waitForTimeout(1000);
    const rxScreenshot = path.join(screenshotsDir, 'desktop_08_prescriptions.png');
    await page.screenshot({ path: rxScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(rxScreenshot)}`);

    // 1.10 Caretakers Page & Invite Modal
    console.log('[Browser] Navigating to Caretakers Page (#caretakers)...');
    await page.click('a[href="#caretakers"]');
    await page.waitForSelector('#caretakers-list-slot', { timeout: 5000 });
    await page.waitForTimeout(1000);
    const careScreenshot = path.join(screenshotsDir, 'desktop_09_caretakers.png');
    await page.screenshot({ path: careScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(careScreenshot)}`);

    // Open Invite Caretaker Modal
    console.log('[Browser] Testing Invite Caretaker Modal interaction...');
    await page.click('#btn-open-invite-caretaker');
    await page.waitForSelector('#invite-modal.active', { timeout: 3000 });
    await page.waitForTimeout(500);
    const inviteModalScreenshot = path.join(screenshotsDir, 'desktop_09b_invite_modal.png');
    await page.screenshot({ path: inviteModalScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(inviteModalScreenshot)}`);
    await page.click('#btn-close-invite-modal');
    await page.waitForTimeout(500);

    // 1.11 Notifications Page
    console.log('[Browser] Navigating to Notifications Center (#notifications)...');
    await page.click('a[href="#notifications"]');
    await page.waitForSelector('#notifications-feed-slot', { timeout: 5000 });
    await page.waitForTimeout(1000);
    const notifScreenshot = path.join(screenshotsDir, 'desktop_10_notifications.png');
    await page.screenshot({ path: notifScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(notifScreenshot)}`);

    // 1.12 Profile & Settings Page
    console.log('[Browser] Navigating to Profile Page (#profile)...');
    await page.click('a[href="#profile"]');
    await page.waitForSelector('#profile-form', { timeout: 5000 });
    await page.waitForTimeout(1000);
    const profScreenshot = path.join(screenshotsDir, 'desktop_11_profile.png');
    await page.screenshot({ path: profScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(profScreenshot)}`);

    await desktopContext.close();

    // -------------------------------------------------------------------------
    // 2. MULTI-VIEWPORT RESPONSIVENESS SUITE (360px, 390px, 430px, 768px, 1024px, 1440px)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. MULTI-VIEWPORT RESPONSIVENESS SUITE ---');

    const viewports = [
      { name: 'mobile_360', width: 360, height: 740, isMobile: true },
      { name: 'mobile_390', width: 390, height: 844, isMobile: true },
      { name: 'mobile_430', width: 430, height: 932, isMobile: true },
      { name: 'tablet_768', width: 768, height: 1024, isMobile: false },
      { name: 'tablet_1024', width: 1024, height: 768, isMobile: false },
      { name: 'desktop_1440', width: 1440, height: 900, isMobile: false },
    ];

    for (const vp of viewports) {
      console.log(`\n[Viewport Test] Testing ${vp.name} (${vp.width}x${vp.height})...`);
      const vpContext = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
        deviceScaleFactor: vp.isMobile ? 2 : 1,
      });
      const vpPage = await vpContext.newPage();

      await vpPage.goto('http://localhost:5000/#login');
      await vpPage.fill('#login-email', 'patient@meditrack.local');
      await vpPage.fill('#login-password', 'Password@123');
      await vpPage.click('#login-form button[type="submit"]');

      await vpPage.waitForSelector('#stat-total', { timeout: 10000 });
      await vpPage.waitForFunction(() => {
        const el = document.getElementById('stat-total');
        return el && el.textContent && el.textContent.trim() !== '--' && !el.querySelector('.skeleton-shimmer');
      }, { timeout: 15000 }).catch(() => {});
      await vpPage.waitForTimeout(800);

      // Check horizontal overflow
      const overflow = await vpPage.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      console.log(`  Horizontal Overflow: ${overflow ? '⚠️ DETECTED' : '✓ NONE (Passed 0 overflow)'}`);

      const vpScreenshot = path.join(screenshotsDir, `${vp.name}_dashboard.png`);
      await vpPage.screenshot({ path: vpScreenshot, fullPage: false });
      console.log(`  ✓ Screenshot: ${path.basename(vpScreenshot)}`);

      // Test mobile menu drawer if mobile/tablet
      if (vp.width <= 768) {
        console.log(`  Testing mobile hamburger menu on ${vp.name}...`);
        await vpPage.click('#btn-toggle-menu');
        await vpPage.waitForSelector('#main-sidebar.mobile-open', { timeout: 3000 });
        const drawerScreenshot = path.join(screenshotsDir, `${vp.name}_menu_drawer.png`);
        await vpPage.screenshot({ path: drawerScreenshot, fullPage: false });
        console.log(`  ✓ Screenshot: ${path.basename(drawerScreenshot)}`);
        // Close menu cleanly
        await vpPage.evaluate(() => document.getElementById('sidebar-backdrop')?.click());
        await vpPage.waitForTimeout(300);
      }

      await vpContext.close();
    }

    // -------------------------------------------------------------------------
    // 2B. MOBILE SUB-PAGES VIEWPORT TESTING (375 x 667 - Standard Mobile)
    // -------------------------------------------------------------------------
    console.log('\n--- 2B. MOBILE SUB-PAGES SUITE (375 x 667) ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.goto('http://localhost:5000/#login');
    await mobilePage.fill('#login-email', 'patient@meditrack.local');
    await mobilePage.fill('#login-password', 'Password@123');
    await mobilePage.click('#login-form button[type="submit"]');
    await mobilePage.waitForSelector('#stat-total', { timeout: 8000 });
    await mobilePage.waitForFunction(() => {
      const el = document.getElementById('stat-total');
      return el && el.textContent && el.textContent.trim() !== '--' && !el.querySelector('.skeleton-shimmer');
    }, { timeout: 15000 }).catch(() => {});
    await mobilePage.waitForTimeout(1000);

    // 2.1 Mobile Dashboard
    console.log('[Mobile] Capturing Mobile Dashboard...');
    const mDashScreenshot = path.join(screenshotsDir, 'mobile_01_dashboard.png');
    await mobilePage.screenshot({ path: mDashScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(mDashScreenshot)}`);

    // 2.2 Mobile Schedule
    console.log('[Mobile] Navigating to Mobile Schedule (#schedule)...');
    await mobilePage.goto('http://localhost:5000/#schedule');
    await mobilePage.waitForSelector('#schedule-doses-list', { timeout: 5000 });
    await mobilePage.waitForTimeout(1000);
    const mSchedScreenshot = path.join(screenshotsDir, 'mobile_02_schedule.png');
    await mobilePage.screenshot({ path: mSchedScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(mSchedScreenshot)}`);

    // 2.3 Mobile Medicines
    console.log('[Mobile] Navigating to Mobile Medicines (#medicines)...');
    await mobilePage.goto('http://localhost:5000/#medicines');
    await mobilePage.waitForSelector('.medicines-grid', { timeout: 5000 });
    await mobilePage.waitForFunction(() => {
      const stock = document.querySelector('.med-stock-status');
      return stock && stock.textContent && !stock.textContent.includes('--');
    }, { timeout: 10000 }).catch(() => {});
    await mobilePage.waitForTimeout(1000);
    const mMedsScreenshot = path.join(screenshotsDir, 'mobile_03_medicines.png');
    await mobilePage.screenshot({ path: mMedsScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(mMedsScreenshot)}`);

    // 2.4 Mobile Inventory
    console.log('[Mobile] Navigating to Mobile Inventory (#inventory)...');
    await mobilePage.goto('http://localhost:5000/#inventory');
    await mobilePage.waitForSelector('.table-responsive', { timeout: 5000 });
    await mobilePage.waitForTimeout(1000);
    const mInvScreenshot = path.join(screenshotsDir, 'mobile_04_inventory.png');
    await mobilePage.screenshot({ path: mInvScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(mInvScreenshot)}`);

    // 2.5 Mobile Analytics
    console.log('[Mobile] Navigating to Mobile Analytics (#analytics)...');
    await mobilePage.goto('http://localhost:5000/#analytics');
    await mobilePage.waitForSelector('.stats-grid', { timeout: 5000 });
    await mobilePage.waitForTimeout(1000);
    const mAnaScreenshot = path.join(screenshotsDir, 'mobile_05_analytics.png');
    await mobilePage.screenshot({ path: mAnaScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(mAnaScreenshot)}`);

    await mobileContext.close();

    // -------------------------------------------------------------------------
    // 3. CARETAKER DASHBOARD MONITORING VIEW
    // -------------------------------------------------------------------------
    console.log('\n--- 3. CARETAKER MONITORING SUITE (1280 x 800) ---');
    const caretakerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const cPage = await caretakerContext.newPage();

    console.log('[Caretaker] Logging in as Caretaker (caretaker@meditrack.local)...');
    await cPage.goto('http://localhost:5000/#login');
    await cPage.fill('#login-email', 'caretaker@meditrack.local');
    await cPage.fill('#login-password', 'Password@123');
    await cPage.click('#login-form button[type="submit"]');

    await cPage.waitForSelector('#stat-total', { timeout: 10000 });
    await cPage.waitForFunction(() => {
      const el = document.getElementById('stat-total');
      return el && el.textContent && el.textContent.trim() !== '--' && !el.querySelector('.skeleton-shimmer');
    }, { timeout: 15000 }).catch(() => {});
    await cPage.waitForSelector('.caretaker-view-banner', { timeout: 10000 }).catch(() => console.log('Caretaker banner check'));
    await cPage.waitForTimeout(1000);

    const caretakerScreenshot = path.join(screenshotsDir, 'desktop_12_caretaker_monitoring.png');
    await cPage.screenshot({ path: caretakerScreenshot, fullPage: false });
    console.log(`✓ Screenshot captured: ${path.basename(caretakerScreenshot)}`);

    await caretakerContext.close();

  } finally {
    await browser.close();
  }

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(' BROWSER AUTOMATION & VISUAL VERIFICATION SUMMARY');
  console.log('========================================================================');
  console.log(`Console Errors Caught:   ${consoleErrors.length}`);
  console.log(`Network Failures Caught: ${networkFailures.length}`);
  if (consoleErrors.length > 0) {
    console.log('Console Errors:', consoleErrors);
  }
  if (networkFailures.length > 0) {
    console.log('Network Failures:', networkFailures);
  }
  const screenshots = fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png'));
  console.log(`Total Screenshots Captured: ${screenshots.length}`);
  screenshots.forEach((s, idx) => {
    const size = Math.round(fs.statSync(path.join(screenshotsDir, s)).size / 1024);
    console.log(`  [${idx + 1}] ${s} (${size} KB)`);
  });
  console.log('========================================================================\n');
}

runBrowserAcceptanceTests().catch(console.error);
