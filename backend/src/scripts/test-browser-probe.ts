import { chromium } from 'playwright';

async function probe() {
  console.log('Testing browser launch with msedge channel...');
  try {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    console.log('✓ Edge launched successfully!');
    const page = await browser.newPage();
    await page.goto('http://localhost:5000');
    console.log('✓ Page title:', await page.title());
    await page.screenshot({ path: 'probe_edge.png' });
    console.log('✓ Screenshot saved: probe_edge.png');
    await browser.close();
    return;
  } catch (err: any) {
    console.error('Edge failed:', err.message);
  }

  console.log('Testing browser launch with chrome channel...');
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    console.log('✓ Chrome launched successfully!');
    const page = await browser.newPage();
    await page.goto('http://localhost:5000');
    console.log('✓ Page title:', await page.title());
    await page.screenshot({ path: 'probe_chrome.png' });
    console.log('✓ Screenshot saved: probe_chrome.png');
    await browser.close();
  } catch (err: any) {
    console.error('Chrome failed:', err.message);
  }
}

probe().catch(console.error);
