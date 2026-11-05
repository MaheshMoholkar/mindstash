/** Exports the landing page's terminal windows as README PNGs. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const site = new URL('../site/index.html', import.meta.url);
const output = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  // The terminal font is bundled with the site. The rest of the capture runs offline.
  await page.route('https://**', (route) => route.abort());
  await page.goto(site.href);
  await page.addStyleTag({ content: '.window figcaption, .window .caption { display: none; }' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  await page.locator('.hero .window').screenshot({ path: join(output, 'main.png') });
  for (const name of ['detail', 'palette']) {
    await page.locator(`#tab-${name}`).click();
    await page.locator('#how .window').screenshot({ path: join(output, `${name}.png`) });
  }
} finally {
  await browser.close();
}
