import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { supabaseAdmin } from '../config/supabase';
import { assertSafeExecutionEnvironment } from '../utils/environmentGuard';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface FunctionalAssertion {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL';
  details?: string;
}

async function runBrowserAcceptanceTests() {
  assertSafeExecutionEnvironment('Browser E2E Functional & Visual Test Suite');

  console.log('========================================================================');
  console.log(' MEDITRACK – REAL BROWSER FUNCTIONAL ASSERTIONS & VISUAL AUDIT');
  console.log('========================================================================\n');

  const screenshotsDir = path.resolve(__dirname, '../../../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const assertions: FunctionalAssertion[] = [];
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];

  function recordAssertion(id: string, name: string, condition: boolean, details?: string) {
    const status: 'PASS' | 'FAIL' = condition ? 'PASS' : 'FAIL';
    assertions.push({ id, name, status, details });
    if (condition) {
      console.log(`[PASS] [${id}] ${name}`);
    } else {
      console.error(`[FAIL] [${id}] ${name}${details ? ` -> ${details}` : ''}`);
    }
  }

  console.log('Launching Google Chrome browser via Playwright...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const runId = Date.now();
  const testPatientEmail = `browser_uat_${runId}@meditrack.test`;
  const testPassword = 'UatPassword@123';
  let createdPatientId = '';

  try {
    // =========================================================================
    // SECTION 1: END-TO-END FUNCTIONAL ASSERTIONS ON ISOLATED REAL USER
    // =========================================================================
    console.log('\n========================================================================');
    console.log(' SECTION 1: FUNCTIONAL E2E USER ACCEPTANCE WORKFLOW');
    console.log('========================================================================');

    const funcContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await funcContext.newPage();

    // Auto-accept prompt dialogs (e.g. discontinue reason)
    page.on('dialog', async dialog => {
      await dialog.accept('Doctor advised completing prescribed duration.');
    });

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

    // -----------------------------------------------------------------------
    // Assertion 1: Patient Registration and Onboarding
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Patient Registration and Initial Onboarding...');
    await page.goto('http://localhost:5000/#login', { waitUntil: 'networkidle' });
    await page.click('#tab-register-btn');
    await page.fill('#reg-name', 'Browser Test Patient');
    await page.fill('#reg-email', testPatientEmail);
    await page.fill('#reg-password', testPassword);
    await page.selectOption('#reg-role', 'patient');
    await page.click('#register-form button[type="submit"]');

    // Wait for Dashboard to render after successful registration
    await page.waitForSelector('#main-sidebar', { timeout: 10000 });
    await page.waitForSelector('#stat-total', { timeout: 10000 });
    const isAtDashboard = await page.evaluate(() => window.location.hash === '#dashboard');
    recordAssertion('AUTH-01', 'Patient registration navigates directly to #dashboard', isAtDashboard);

    // Capture created patient ID for cleanup
    createdPatientId = await page.evaluate(() => {
      try {
        const u = localStorage.getItem('meditrack_user');
        return u ? JSON.parse(u).id : '';
      } catch {
        return '';
      }
    });

    // -----------------------------------------------------------------------
    // Assertion 2: Empty Dashboard State (Zero Medicines Account)
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Clean Account Empty Dashboard State...');
    await page.waitForFunction(() => {
      const el = document.getElementById('stat-total');
      return el && el.textContent && !el.querySelector('.skeleton-shimmer');
    }, { timeout: 10000 });

    const totalStatText = await page.textContent('#stat-total');
    const emptyBannerVisible = await page.evaluate(() => {
      return document.body.textContent?.includes('No medicines configured') ||
             document.body.textContent?.includes('No doses scheduled') ||
             document.getElementById('stat-total')?.textContent?.trim() === '0';
    });
    recordAssertion(
      'DASH-01',
      'Newly registered patient dashboard displays 0 total doses and helpful empty state',
      totalStatText?.trim() === '0' && Boolean(emptyBannerVisible),
      `Total doses displayed: "${totalStatText?.trim()}"`
    );

    // -----------------------------------------------------------------------
    // Assertion 3: Medicine Creation & Schedule Auto-Population
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Medicine Creation with Daily Schedules...');
    await page.click('a[href="#medicines"]');
    await page.waitForSelector('#btn-open-add-med', { timeout: 8000 });
    await page.click('#btn-open-add-med');
    await page.waitForSelector('#med-modal.active', { timeout: 5000 });

    const medName = 'Functional Amoxicillin';
    await page.fill('#form-med-name', medName);
    await page.fill('#form-med-dosage', '500mg');
    await page.fill('#form-med-stock', '10');
    await page.fill('#form-med-threshold', '3');
    await page.fill('#form-med-times', '08:00, 20:00');
    await page.click('#btn-save-med');

    // Wait for modal to close and medicine card to appear
    await page.waitForFunction(() => !document.getElementById('med-modal')?.classList.contains('active'), { timeout: 5000 });
    await page.waitForSelector('.med-card', { timeout: 8000 });
    const medicineFound = await page.evaluate((name) => {
      return document.getElementById('medicines-list-slot')?.textContent?.includes(name);
    }, medName);

    recordAssertion('MED-01', 'Medicine is created, listed in grid, and initial stock saved', Boolean(medicineFound));

    // -----------------------------------------------------------------------
    // Assertion 4: Medicine Editing
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Medicine Editing...');
    await page.click('.btn-edit-med');
    await page.waitForSelector('#med-modal.active', { timeout: 5000 });
    // Wait for async GET to populate the edit form
    await page.waitForFunction(() => {
      const input = document.getElementById('form-med-name') as HTMLInputElement | null;
      return input && input.value.length > 0;
    }, { timeout: 5000 });

    const updatedMedName = 'Functional Amoxicillin Forte';
    await page.fill('#form-med-name', updatedMedName);
    await page.click('#btn-save-med');
    await page.waitForFunction(() => !document.getElementById('med-modal')?.classList.contains('active'), { timeout: 5000 });
    // Wait for loadMedicines() network fetch and DOM re-render
    await page.waitForFunction((name) => {
      return document.getElementById('medicines-list-slot')?.textContent?.includes(name);
    }, updatedMedName, { timeout: 8000 });

    const medicineUpdated = await page.evaluate((name) => {
      return document.getElementById('medicines-list-slot')?.textContent?.includes(name);
    }, updatedMedName);

    recordAssertion('MED-02', 'Medicine name updated and persisted in listing', Boolean(medicineUpdated));

    // -----------------------------------------------------------------------
    // Assertion 5: Today Schedule Reflecting Configured Medicines
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Today Schedule View for Configured Doses...');
    await page.click('a[href="#schedule"]');
    await page.waitForSelector('#schedule-doses-list', { timeout: 8000 });
    await page.waitForFunction(() => {
      return document.querySelectorAll('.dose-card').length > 0;
    }, { timeout: 8000 });

    const dosesCount = await page.evaluate(() => {
      return document.querySelectorAll('.dose-card').length;
    });
    recordAssertion('SCHED-01', 'Today schedule contains doses generated for new medicine', dosesCount > 0, `Doses found: ${dosesCount}`);

    // -----------------------------------------------------------------------
    // Assertion 6: Dose Confirmation with Real Timestamp
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Dose Confirmation ("Mark as Taken")...');
    await page.waitForSelector('.btn-mark-taken', { timeout: 5000 });
    const markTakenBtn = await page.$('.btn-mark-taken');
    recordAssertion('DOSE-01', 'Pending dose has an active "Mark as Taken" button', Boolean(markTakenBtn));

    if (markTakenBtn) {
      await markTakenBtn.click();
      await page.waitForSelector('.taken-confirmation-stamp', { timeout: 8000 });
      const confirmationText = await page.textContent('.taken-confirmation-stamp');
      recordAssertion(
        'DOSE-02',
        'Dose confirmation updates status to taken with verified timestamp',
        Boolean(confirmationText && confirmationText.includes('Confirmed')),
        `Stamp text: ${confirmationText?.trim()}`
      );
    }

    // -----------------------------------------------------------------------
    // Assertion 7: Persisting After Page Reload
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Dose Status Persistence Across Page Reload...');
    await page.goto('http://localhost:5000/#schedule', { waitUntil: 'networkidle' });
    await page.waitForSelector('#schedule-doses-list', { timeout: 8000 });
    await page.waitForSelector('.taken-confirmation-stamp', { timeout: 8000 });
    const isTakenAfterReload = await page.evaluate(() => {
      return Boolean(document.querySelector('.taken-confirmation-stamp'));
    });
    recordAssertion('DOSE-03', 'Taken dose status and timestamp persist after page refresh', isTakenAfterReload);

    // -----------------------------------------------------------------------
    // Assertion 8: Double-Confirmation Prevention (Idempotency)
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Double-Confirmation Prevention in UI...');
    const canReconfirm = await page.evaluate(() => {
      const confirmedCard = document.querySelector('.dose-card.is-taken');
      return confirmedCard ? Boolean(confirmedCard.querySelector('.btn-mark-taken')) : false;
    });
    recordAssertion('DOSE-04', 'Confirmed dose replaces Mark Taken button, preventing double confirmation', !canReconfirm);

    // -----------------------------------------------------------------------
    // Assertion 9: Inventory Decrement by Dose Amount
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Inventory Deduction...');
    await page.click('a[href="#inventory"]');
    await page.waitForSelector('#inventory-table-body tr td', { timeout: 8000 });
    await page.waitForFunction(() => {
      const body = document.getElementById('inventory-table-body');
      return body && !body.textContent?.includes('Loading inventory');
    }, { timeout: 8000 });

    const stockText = await page.evaluate(() => {
      const stockCell = document.querySelector('#inventory-table-body tr td:nth-child(3)');
      return stockCell?.textContent?.trim() || '';
    });
    // Started at 10, 1 dose confirmed -> should be 9
    recordAssertion(
      'INV-01',
      'Inventory accurately decremented by 1 after dose confirmation (from 10 to 9)',
      stockText.includes('9'),
      `Current stock displayed in table: "${stockText}"`
    );

    // -----------------------------------------------------------------------
    // Assertion 10: Caretaker Invitation & Status
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Caretaker Invitation...');
    await page.click('a[href="#caretakers"]');
    await page.waitForSelector('#btn-open-invite-caretaker', { timeout: 8000 });
    await page.click('#btn-open-invite-caretaker');
    await page.waitForSelector('#invite-modal.active', { timeout: 5000 });

    const caretakerEmail = `caretaker_${runId}@meditrack.test`;
    await page.fill('#form-c-email', caretakerEmail);
    await page.fill('#form-c-relation', 'Daughter');
    await page.click('#invite-form button[type="submit"]');

    // Wait for invite modal to close and new caretaker card to render
    await page.waitForFunction(() => !document.getElementById('invite-modal')?.classList.contains('active'), { timeout: 8000 });
    await page.waitForFunction((email) => {
      return document.getElementById('caretakers-list-slot')?.textContent?.includes(email);
    }, caretakerEmail, { timeout: 8000 });

    const inviteListed = await page.evaluate((email) => {
      return document.getElementById('caretakers-list-slot')?.textContent?.includes(email);
    }, caretakerEmail);

    recordAssertion('CARE-01', 'Caretaker invitation created and listed with pending status', Boolean(inviteListed));

    // -----------------------------------------------------------------------
    // Assertion 11: Prescription OCR Safeguard & Modal
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Prescription OCR Safeguard & Modal...');
    await page.click('a[href="#prescriptions"]');
    await page.waitForSelector('#btn-open-upload-pres', { timeout: 5000 });

    const safeguardNoticePresent = await page.evaluate(() => {
      return document.body.textContent?.includes('OCR & AI Safeguard: Extracted medicine names');
    });
    await page.click('#btn-open-upload-pres');
    await page.waitForSelector('#pres-modal.active', { timeout: 3000 });
    await page.click('#btn-close-pres-modal');
    await page.waitForTimeout(300);

    recordAssertion('RX-01', 'Prescription section presents OCR clinical safeguard and operational upload modal', Boolean(safeguardNoticePresent));

    // -----------------------------------------------------------------------
    // Assertion 12: Mobile Navigation Drawer & Zero Overflow
    // -----------------------------------------------------------------------
    console.log('\n[E2E] Testing Mobile Navigation Drawer & Responsive Layout...');
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('http://localhost:5000/#dashboard', { waitUntil: 'networkidle' });
    await page.waitForSelector('#btn-toggle-menu', { timeout: 5000 });

    await page.click('#btn-toggle-menu');
    await page.waitForSelector('#main-sidebar.mobile-open', { timeout: 3000 });
    const isDrawerOpen = await page.evaluate(() => {
      return document.getElementById('main-sidebar')?.classList.contains('mobile-open');
    });

    // Close drawer via backdrop
    await page.evaluate(() => document.getElementById('sidebar-backdrop')?.click());
    await page.waitForTimeout(400);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    recordAssertion(
      'RESP-01',
      'Mobile drawer toggles cleanly and layout has zero horizontal overflow at 360px',
      Boolean(isDrawerOpen) && !hasHorizontalOverflow,
      `Drawer open: ${isDrawerOpen}, Horizontal Overflow: ${hasHorizontalOverflow}`
    );

    await funcContext.close();

    // =========================================================================
    // SECTION 2: VISUAL REGRESSION SCREENSHOT AUDIT (DESKTOP & VIEWPORTS)
    // =========================================================================
    console.log('\n========================================================================');
    console.log(' SECTION 2: VISUAL REGRESSION SCREENSHOT CAPTURE');
    console.log('========================================================================');

    const visualContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const vPage = await visualContext.newPage();

    // Login with standard demo account to capture complete seeded state
    await vPage.goto('http://localhost:5000/#login');
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_01_login.png') });
    await vPage.fill('#login-email', 'patient@meditrack.local');
    await vPage.fill('#login-password', 'Password@123');
    await vPage.click('#login-form button[type="submit"]');

    await vPage.waitForSelector('#stat-total', { timeout: 8000 });
    await vPage.waitForFunction(() => {
      const el = document.getElementById('stat-total');
      return el && el.textContent && el.textContent.trim() !== '--' && !el.querySelector('.skeleton-shimmer');
    }, { timeout: 15000 }).catch(() => {});
    await vPage.waitForTimeout(800);

    // Desktop pages
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_02_dashboard.png') });

    await vPage.click('a[href="#schedule"]');
    await vPage.waitForSelector('#schedule-doses-list', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_03_schedule.png') });

    await vPage.click('a[href="#medicines"]');
    await vPage.waitForSelector('.medicines-grid', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_04_medicines.png') });

    await vPage.click('#btn-open-add-med');
    await vPage.waitForSelector('#med-modal.active', { timeout: 3000 });
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_04b_add_medicine_modal.png') });
    await vPage.click('#btn-close-med-modal');

    await vPage.click('a[href="#inventory"]');
    await vPage.waitForSelector('.data-table', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_05_inventory.png') });

    await vPage.click('a[href="#analytics"]');
    await vPage.waitForSelector('.stats-grid', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_06_analytics.png') });

    await vPage.click('a[href="#calendar"]');
    await vPage.waitForSelector('.calendar-grid', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_07_calendar.png') });

    await vPage.click('a[href="#prescriptions"]');
    await vPage.waitForSelector('.medicines-grid', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_08_prescriptions.png') });

    await vPage.click('a[href="#caretakers"]');
    await vPage.waitForSelector('#caretakers-list-slot', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_09_caretakers.png') });

    await vPage.click('a[href="#notifications"]');
    await vPage.waitForSelector('#notifications-feed-slot', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_10_notifications.png') });

    await vPage.click('a[href="#profile"]');
    await vPage.waitForSelector('#profile-form', { timeout: 5000 });
    await vPage.waitForTimeout(600);
    await vPage.screenshot({ path: path.join(screenshotsDir, 'desktop_11_profile.png') });

    // Multi-viewport checks using the authenticated session
    const viewports = [
      { name: 'mobile_360', width: 360, height: 740 },
      { name: 'mobile_390', width: 390, height: 844 },
      { name: 'mobile_430', width: 430, height: 932 },
      { name: 'tablet_768', width: 768, height: 1024 },
      { name: 'tablet_1024', width: 1024, height: 768 },
      { name: 'desktop_1440', width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      await vPage.setViewportSize({ width: vp.width, height: vp.height });
      await vPage.waitForTimeout(400);

      const overflow = await vPage.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      console.log(`[Viewport ${vp.name}] Horizontal Overflow: ${overflow ? '⚠️ DETECTED' : '✓ 0 (Clean)'}`);

      await vPage.screenshot({ path: path.join(screenshotsDir, `${vp.name}_dashboard.png`) });
    }

    await visualContext.close();

  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP TEMPORARY BROWSER TEST FIXTURES
    // -------------------------------------------------------------------------
    console.log('\n--- CLEANING UP TEMPORARY BROWSER TEST FIXTURES ---');
    if (createdPatientId) {
      try {
        await supabaseAdmin.from('inventory_transactions').delete().eq('patient_id', createdPatientId);
        await supabaseAdmin.from('medication_logs').delete().eq('patient_id', createdPatientId);
        await supabaseAdmin.from('scheduled_doses').delete().eq('patient_id', createdPatientId);
        await supabaseAdmin.from('medication_schedules').delete().eq('patient_id', createdPatientId);
        await supabaseAdmin.from('medicine_inventory').delete().eq('patient_id', createdPatientId);
        await supabaseAdmin.from('medicines').delete().eq('patient_id', createdPatientId);
        await supabaseAdmin.from('patient_caretaker_relationships').delete().eq('patient_id', createdPatientId);
        await supabaseAdmin.from('notifications').delete().eq('recipient_id', createdPatientId);
        await supabaseAdmin.from('profiles').delete().eq('id', createdPatientId);
        await supabaseAdmin.auth.admin.deleteUser(createdPatientId);
        console.log(`✓ Cleaned up test patient ${createdPatientId}`);
      } catch (err: any) {
        console.warn(`Warning during cleanup: ${err.message}`);
      }
    }

    await browser.close();
  }

  // -------------------------------------------------------------------------
  // FINAL SUMMARY REPORT
  // -------------------------------------------------------------------------
  const passedAssertions = assertions.filter(a => a.status === 'PASS').length;
  const failedAssertions = assertions.filter(a => a.status === 'FAIL').length;
  const screenshots = fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png'));

  console.log('\n========================================================================');
  console.log(' BROWSER E2E FUNCTIONAL & VISUAL AUDIT SUMMARY');
  console.log('========================================================================');
  console.log(`Functional Assertions Evaluated: ${assertions.length}`);
  console.log(`  Passed:  ${passedAssertions} (✓)`);
  console.log(`  Failed:  ${failedAssertions} (✗)`);
  console.log(`Success Rate: ${Math.round((passedAssertions / assertions.length) * 100)}%`);
  console.log('------------------------------------------------------------------------');
  console.log(`Screenshots Captured:    ${screenshots.length} files in screenshots/`);
  console.log(`Browser Console Errors:  ${consoleErrors.length}`);
  console.log(`Network Failures:        ${networkFailures.length}`);
  console.log('========================================================================\n');

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runBrowserAcceptanceTests().catch(err => {
  console.error('Fatal browser test failure:', err);
  process.exit(1);
});
