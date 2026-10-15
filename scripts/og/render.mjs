// Renders the Open Graph images (1200×630, drawn at 2× and downscaled) into public/og/.
// Fonts come from the @fontsource packages (devDependencies); run: npm run og
// CHROME_PATH lets a machine with its own Chromium skip the Playwright download.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
// One source page per language
const variants = [
  { html: 'og.html', out: 'og-image.jpg' },
  { html: 'og-en.html', out: 'og-image-en.jpg' },
];

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(here, v.html), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  const out = path.join(here, '..', '..', 'public', 'og', v.out);
  await sharp(png).resize(1200, 630).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
  console.log('wrote', out);
}
await browser.close();
