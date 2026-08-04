import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('console', msg => console.log(`[console:${msg.type()}] ${msg.text()}`));
page.on('requestfailed', req => {
  if (req.url().includes('tiktok')) console.log(`[reqfail] ${req.url()} — ${req.failure()?.errorText}`);
});

const responses = [];
page.on('response', async res => {
  if (res.url().includes('/api/tiktok')) {
    const body = await res.text().catch(e => `(err: ${e.message})`);
    responses.push({ status: res.status(), url: res.url(), body });
  }
});

await page.goto('http://localhost:3001/tiktok');
await page.waitForLoadState('networkidle');

// Use a brand new URL that's definitely not cached
const TEST_URL = 'https://www.tiktok.com/@annafrey/video/7669116007587319053?is_from_webapp=1&sender_device=pc';
await page.fill('input[type="text"]', TEST_URL);
await page.click('button:has-text("Grab")');
console.log('Clicked Grab — waiting up to 2min...');

// Wait for EITHER a result, an error, OR the loading text to disappear
await page.waitForFunction(() => {
  const btn = document.querySelector('button');
  return btn && !btn.textContent?.includes('Processing');
}, { timeout: 120000 }).catch(() => console.log('Still processing after 2 min'));

console.log('\n=== API RESPONSES ===');
for (const r of responses) {
  console.log(`${r.status} ${r.url}`);
  console.log('Body:', r.body.slice(0, 500));
}

const errorEl = await page.$eval('[role="alert"]', el => el.textContent).catch(() => null);
const downloadEl = await page.$eval('a[download]', el => el.getAttribute('href')).catch(() => null);
const btnText = await page.$eval('button', el => el.textContent).catch(() => null);
console.log('\nError:', errorEl);
console.log('Download:', downloadEl);
console.log('Button text:', btnText);

await page.screenshot({ path: 'test-tiktok-result.png' });
await browser.close();
