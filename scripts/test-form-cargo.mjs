// Role selector of the contact form in a real browser (Chromium via Playwright), on the built site:
// click and keyboard choice, Esc inside the dialog, a tap outside, validation and the value sent.
// Needs a previous `npm run build` (reads dist/). Run: node scripts/test-form-cargo.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('test-form-cargo: skipped (Playwright not installed)'); process.exit(0); }
const raiz = path.resolve('dist');
if (!fs.existsSync(path.join(raiz, 'contato.html'))) { console.log('test-form-cargo: skipped (run npm run build first)'); process.exit(0); }

const srv = http.createServer((q, r) => {
  let f = path.join(raiz, decodeURIComponent(q.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  const tipo = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream';
  r.writeHead(200, { 'content-type': tipo }); r.end(fs.readFileSync(f));
}).listen(0);
const base = `http://localhost:${srv.address().port}`;

const abre = async () => {
  try { return await chromium.launch(); } catch (e) {
    for (const executablePath of [process.env.PLAYWRIGHT_CHROMIUM, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)) {
      if (fs.existsSync(executablePath)) return chromium.launch({ executablePath });
    }
    throw e;
  }
};
const browser = await abre();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let enviado = null;
  await page.route('**/receberFicha', (r) => { enviado = JSON.parse(r.request().postData() || '{}'); r.fulfill({ status: 201, contentType: 'application/json', body: '{"id":"x"}' }); });

  // 1. Contact page: no native select, closed list, placeholder shown and not offered as an option
  await page.goto(`${base}/contato`);
  const F = 'main form[data-funcao]';
  assert.equal(await page.locator(`${F} select`).count(), 0, 'no native select');
  const campo = page.locator(`${F} .cpk__campo`);
  const lista = page.locator(`${F} .cpk__lista`);
  assert.equal(await lista.isHidden(), true, 'list starts closed');
  assert.equal((await campo.textContent()).trim(), 'Selecione');
  assert.equal(await page.locator(`${F} .cpk__opcao`).count(), 7, 'seven roles, no placeholder option');
  assert.equal(await campo.getAttribute('aria-expanded'), 'false');

  // 2. Submit without a role: error shown, focus on the selector button, nothing sent
  await page.fill(`${F} [name=nome]`, 'Teste');
  await page.fill(`${F} [name=empresa]`, 'Empresa');
  await page.fill(`${F} [name=email]`, 'a@b.co');
  await page.click(`${F} button[type=submit]`);
  assert.equal(await page.locator(`${F} [id$="cargo-erro"]`).isVisible(), true, 'role error visible');
  assert.equal(await campo.getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('cpk__campo')), true, 'focus on the selector');
  assert.equal(enviado, null);

  // 3. Click opens, a tap outside closes without a value
  await campo.click();
  assert.equal(await lista.isVisible(), true);
  assert.equal(await campo.getAttribute('aria-expanded'), 'true');
  await page.mouse.click(5, 5);
  assert.equal(await lista.isHidden(), true, 'tap outside closes');
  assert.equal(await page.inputValue(`${F} [name=cargo]`), '');

  // 4. Click chooses and closes; error clears; check mark on the chosen option
  await campo.click();
  await page.locator(`${F} .cpk__opcao[data-valor=ceo]`).click();
  assert.equal(await lista.isHidden(), true);
  assert.equal(await page.inputValue(`${F} [name=cargo]`), 'ceo');
  assert.equal((await campo.textContent()).trim(), 'CEO ou presidente');
  assert.equal(await campo.getAttribute('aria-invalid'), 'false');
  assert.equal(await page.locator(`${F} [id$="cargo-erro"]`).isHidden(), true);
  assert.equal(await page.locator(`${F} .cpk__opcao[data-valor=ceo]`).getAttribute('aria-selected'), 'true');

  // 5. Keyboard: ArrowDown opens on the chosen option, End + Enter choose the last, Esc keeps the value
  await campo.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-valor')), 'ceo', 'opens on the chosen option');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(await page.inputValue(`${F} [name=cargo]`), 'other');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('cpk__campo')), true, 'focus back on the selector');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Escape');
  assert.equal(await lista.isHidden(), true);
  assert.equal(await page.inputValue(`${F} [name=cargo]`), 'other', 'Esc does not change the value');

  // 6. Submit sends the role value
  await page.click(`${F} button[type=submit]`);
  await page.waitForFunction(() => document.querySelector('main [data-contato-sucesso]')?.hidden === false);
  assert.equal(enviado.cargo, 'other');
  assert.equal(enviado.nome, 'Teste');

  // 7. Dialog: Esc in the open list closes the list, not the dialog; the light theme keeps the list in tokens
  await page.goto(`${base}/casos/elite-90-pro`);
  await page.evaluate(() => document.querySelector('[data-abrir-contato]').click());
  const D = 'dialog form[data-funcao]';
  await page.waitForSelector(D, { state: 'visible' });
  await page.locator(`${D} .cpk__campo`).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600); // the dialog closes with an animation: wait past it before checking
  assert.equal(await page.locator(`${D} .cpk__lista`).isHidden(), true, 'Esc closes the list');
  assert.equal(await page.evaluate(() => document.querySelector('dialog')?.open), true, 'the dialog stays open');
  console.log('test-form-cargo: ok');
} finally {
  await browser.close();
  srv.close();
}
