import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();

await page.route('**/api/clip-studio/fetch', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      videoId: 'test123',
      title: 'Test Video',
      channel: 'Test Channel',
      durationSec: 120,
      transcript: [{ start: 0, end: 5, text: 'Hello world' }],
      heatmap: [],
      captionsAvailable: true,
    }),
  });
});

await page.route('**/api/clip-studio/cut', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      results: [
        { start: 0, end: 30, label: 'test clip', filename: 'clip-0.mp4', url: '/api/clip-studio/file?id=test123&clip=0' },
      ],
      errors: [],
    }),
  });
});

await page.goto('http://localhost:3001/clip-studio');
await page.waitForLoadState('networkidle');

await page.fill('input[type="text"]', 'https://youtube.com/watch?v=test');
const fetchBtn = page.locator('button:has-text("Fetch")');
console.log('Fetch button enabled:', await fetchBtn.isEnabled());
await fetchBtn.click();
await page.waitForSelector('text=Test Video', { timeout: 10000 });
console.log('Fetch done');

await page.fill('textarea', '0:00-0:30 | test clip');
await page.waitForTimeout(200);
const cutBtn = page.locator('button:has-text("Cut")').first();
console.log('Cut button text:', await cutBtn.textContent());
await cutBtn.click();
await page.waitForSelector('text=Cuts (1)', { timeout: 10000 });
console.log('Cut done');

const previewBtn = page.locator('button:has-text("Preview")');
console.log('Preview button count:', await previewBtn.count());
await page.screenshot({ path: 'test-preview-before.png' });

await previewBtn.click();
await page.waitForTimeout(400);
const videoEl = page.locator('video');
console.log('Video element visible:', await videoEl.isVisible());
await page.screenshot({ path: 'test-preview-modal.png' });

// Close by clicking the backdrop (top-left corner, outside the video)
await page.mouse.click(20, 20);
await page.waitForTimeout(300);
console.log('Video after backdrop click (should be hidden):', await videoEl.isVisible().catch(() => false));
await page.screenshot({ path: 'test-preview-closed.png' });

await browser.close();
console.log('Done');
