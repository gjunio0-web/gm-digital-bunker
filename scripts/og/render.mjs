// Renders scripts/og/og.html to public/og/og-image.jpg (1200×630, drawn at 2× and downscaled).
// Fonts come from the @fontsource packages (devDependencies); run: npm run og
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = 'file://' + path.join(here, 'og.html');
const out = path.join(here, '..', '..', 'public', 'og', 'og-image.jpg');

// CHROME_PATH lets a machine with its own Chromium skip the Playwright download
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: 'png' });
await browser.close();
await sharp(png).resize(1200, 630).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
console.log('wrote', out);
