// Action bar in a real browser (Chromium via Playwright): clicks, "Aguarde…", alert, silent success, door selector,
// archive confirmation, "apagar agora" taking the page to the list. Not part of `npm run test:*` unless Playwright exists.
// Run: node scripts/test-admin-acoes-dom.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('test-admin-acoes-dom: skipped (Playwright not installed)'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'acoes-dom-'));
const entrada = join(dir, 'entrada.ts');
const fs = await import('node:fs');
fs.writeFileSync(entrada, `
import { montarFicha, desenharFicha, ligarFicha } from '${process.cwd()}/src/admin/leads/ficha';
import { uiBarraVazia } from '${process.cwd()}/src/admin/leads/detalhe';
import { consumirAvisoLista } from '${process.cwd()}/src/admin/leads/acoes';
(window as any).T = { montarFicha, desenharFicha, ligarFicha, uiBarraVazia, consumirAvisoLista };
`);
const out = join(dir, 'bundle.js');
await build({ entryPoints: [entrada], bundle: true, format: 'iife', outfile: out, logLevel: 'silent' });
const css = readFileSync('src/admin/admin.css', 'utf8') + readFileSync('src/admin/leads/leads.css', 'utf8');

// The Chromium that came with this Playwright, else a system one (PLAYWRIGHT_CHROMIUM / Google Chrome)
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
  const page = await browser.newPage();
  await page.setContent(`<html><body class="adm"><style>${css}</style><div id="raiz"></div></body></html>`);
  await page.addScriptTag({ path: out });

  // Harness: a ficha in `estado`, a controllable `chama`, a recorder of calls and navigation
  await page.evaluate(() => {
    const w = window;
    w.chamadas = []; w.idas = []; w.pendente = null;
    w.monta = (estado, extra = {}) => {
      const raiz = document.getElementById('raiz'); raiz.innerHTML = '';
      w.limpa && w.limpa();
      w.T.montarFicha(raiz);
      w.est = { versao: null, abertos: new Set(), ui: w.T.uiBarraVazia() };
      w.dados = { id: 'f1', f: { estado, analiseAtual: 'v1', nome: 'N', empresa: 'E', ...extra }, analises: [{ id: 'v1', num: 1, d: { autor: { tipo: 'ia' }, secoes: {}, enquadramento: { portaProvavel: 'projeto' } } }], eventos: [], coleta: {} };
      const redesenha = () => w.T.desenharFicha(raiz, w.dados, w.est, new Date());
      w.redesenha = redesenha;
      const chama = (id, acao, p) => { w.chamadas.push([id, acao, p]); return new Promise((res, rej) => { w.pendente = { res, rej }; }); };
      w.limpa = w.T.ligarFicha(raiz, w.est, redesenha, () => w.dados, { id: 'f1', chama, ir: (c) => w.idas.push(c) });
      redesenha();
    };
  });
  const txt = (sel) => page.locator(sel).innerText();
  const chamadas = () => page.evaluate(() => window.chamadas);

  // 1. Aprovar: one call, "Aguarde…" and everything disabled meanwhile, enabled again after the answer
  await page.evaluate(() => window.monta('analise_pronta'));
  assert.equal(await page.locator('.btn.primary').count(), 1);
  await page.click('[data-act="aprovar"]');
  assert.equal(await txt('[data-act="aprovar"]'), 'Aguarde…');
  assert.equal(await page.locator('.actbar button:disabled').count(), 5);
  await page.evaluate(() => window.pendente.res({ ok: true, estado: 'aprovada' }));
  await page.waitForFunction(() => document.querySelector('[data-act="aprovar"]')?.textContent === 'Aprovar análise');
  assert.equal(await page.locator('.actbar button:disabled').count(), 0);
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  assert.deepEqual(await chamadas(), [['f1', 'aprovar', {}]]);

  // 2. Error: text in the page with role="alert", never the raw message; "Fechar aviso" closes it
  await page.click('[data-act="aprovar"]');
  await page.evaluate(() => window.pendente.rej({ code: 'functions/failed-precondition', message: 'CRUA', details: { codigo: 'conflito' } }));
  await page.waitForSelector('[role="alert"]');
  assert.equal(await txt('.acaoerr span'), 'A ficha mudou durante a ação. Confira o estado e tente de novo.');
  assert.ok(!(await page.content()).includes('CRUA'));
  await page.click('[data-act="fechar-aviso"]');
  assert.equal(await page.locator('[role="alert"]').count(), 0);

  // 3. Silent success on repetition (another tab already approved)
  await page.click('[data-act="aprovar"]');
  await page.evaluate(() => window.pendente.rej({ details: { codigo: 'acao_invalida_no_estado', estadoAtual: 'aprovada' } }));
  await page.waitForFunction(() => document.querySelector('[data-act="aprovar"]')?.textContent === 'Aprovar análise');
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  // ...but another state is an error with the label of the state
  await page.click('[data-act="aprovar"]');
  await page.evaluate(() => window.pendente.rej({ details: { codigo: 'acao_invalida_no_estado', estadoAtual: 'coletando' } }));
  await page.waitForSelector('[role="alert"]');
  assert.equal(await txt('.acaoerr span'), 'Esta ação não vale mais para a ficha, que agora está em Coletando.');
  // A new action clears the previous alert
  await page.click('[data-act="aprovar"]');
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  await page.evaluate(() => window.pendente.res({ ok: true }));

  // 4. Door selector: starts on the probable door, one tap chooses, the call carries it
  await page.evaluate(() => window.monta('analise_pronta'));
  assert.equal(await txt('#aPorta .pk-val'), 'Projeto');
  await page.click('#aPorta');
  assert.equal(await page.getAttribute('#aPorta', 'aria-expanded'), 'true');
  await page.click('.pk-opt[data-v="workshop"]');
  assert.equal(await txt('#aPorta .pk-val'), 'Workshop');
  await page.click('[data-act="porta"]');
  assert.deepEqual((await chamadas()).at(-1), ['f1', 'portaDecidida', { porta: 'workshop' }]);
  await page.evaluate(() => window.pendente.res({ ok: true }));
  await page.waitForFunction(() => document.querySelector('[data-act="porta"]')?.textContent === 'Decidir porta');
  assert.equal(await txt('#aPorta .pk-val'), 'Workshop'); // the choice survives the redraw
  // Opening the version selector closes the door selector (spec 05 §5.9)
  await page.click('#aVer');
  assert.equal(await page.getAttribute('#aVer', 'aria-expanded'), 'true');
  assert.equal(await page.getAttribute('#aPorta', 'aria-expanded'), 'false');
  // Combination text as the description of the "Combinação" option
  await page.evaluate(() => { window.dados.analises[0].d.enquadramento = { portaProvavel: 'combinacao', portaCombinacao: 'workshop seguido de conselho' }; window.est.ui.porta = null; window.redesenha(); });
  assert.equal(await txt('#aPorta .pk-val'), 'Combinação');
  await page.click('#aPorta');
  assert.equal(await txt('.pk-opt[data-v="combinacao"] .pk-d'), 'Workshop seguido de conselho');
  // Decided door comes first
  await page.evaluate(() => { window.dados.f.portaDecidida = 'conselho'; window.est.ui.porta = null; window.redesenha(); });
  assert.equal(await txt('#aPorta .pk-val'), 'Conselho');

  // 5. Archive: confirmation in the page; Esc cancels; without "apagar agora" no expurgoImediato true
  await page.evaluate(() => window.monta('resposta_breve'));
  assert.equal(await page.locator('.confirm').count(), 0);
  await page.click('[data-act="arquivar"]');
  assert.equal(await txt('.confirm'), 'Confirmar? Sim, arquivar');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.confirm').count(), 0);
  await page.click('[data-act="arquivar"]');
  await page.click('[data-act="arquivar"]'); // second tap closes too
  assert.equal(await page.locator('.confirm').count(), 0);
  await page.click('[data-act="arquivar"]');
  await page.click('[data-act="arquivar-ok"]');
  assert.deepEqual((await chamadas()).at(-1), ['f1', 'arquivar', { expurgoImediato: false }]);
  await page.evaluate(() => window.pendente.rej({ details: { codigo: 'acao_invalida_no_estado', estadoAtual: 'arquivada' } }));
  await page.waitForFunction(() => document.querySelector('[data-act="arquivar"]')?.textContent === 'Arquivar');
  assert.equal(await page.locator('[role="alert"]').count(), 0); // repeated archive: silent success
  assert.deepEqual(await page.evaluate(() => window.idas), []);

  // 6. "Apagar agora": own wording, expurgoImediato true, the ficha vanishing is not an error, back to the list with the notice
  await page.evaluate(() => window.monta('resposta_breve'));
  await page.check('[data-act="apagar-agora"]');
  await page.click('[data-act="arquivar"]');
  assert.equal(await txt('.confirm'), 'Confirmar? Sim, apagar agora');
  await page.click('[data-act="arquivar-ok"]');
  assert.deepEqual((await chamadas()).at(-1), ['f1', 'arquivar', { expurgoImediato: true }]);
  // The listener reports the document gone before the answer arrives: nothing is redrawn as an error or an empty page
  const antes = await page.locator('#fCorpo').innerHTML();
  await page.evaluate(() => { window.dados = null; window.redesenha(); });
  assert.equal(await page.locator('#fCorpo').innerHTML(), antes);
  await page.evaluate(() => window.pendente.res({ ok: true, estado: 'apagada', analiseAtual: null }));
  await page.waitForFunction(() => window.idas.length === 1);
  assert.deepEqual(await page.evaluate(() => window.idas), ['/admin/leads']);
  assert.equal(await page.evaluate(() => window.T.consumirAvisoLista()), 'Ficha apagada.');

  // 7. "Apagar agora" refused: the page stays, shows the alert and lets the ficha redraw again
  await page.evaluate(() => window.monta('resposta_breve'));
  await page.check('[data-act="apagar-agora"]');
  await page.click('[data-act="arquivar"]');
  await page.click('[data-act="arquivar-ok"]');
  await page.evaluate(() => window.pendente.rej({ details: { codigo: 'interno' } }));
  await page.waitForSelector('[role="alert"]');
  assert.equal(await txt('.acaoerr span'), 'Não foi possível concluir a ação. Tente de novo; se o erro se repetir, avise quem administra o sistema.');
  await page.evaluate(() => { window.dados = null; window.redesenha(); });
  assert.ok((await page.locator('#fCorpo').innerHTML()).includes('Voltar à lista de leads'), 'sem apagamento em curso, o sumiço volta a ser tratado como antes');

  // 8. ficha_inexistente: back to the list with the text as the notice
  await page.evaluate(() => window.monta('analise_pronta'));
  await page.click('[data-act="aprovar"]');
  await page.evaluate(() => window.pendente.rej({ details: { codigo: 'ficha_inexistente' } }));
  await page.waitForFunction(() => window.idas.length === 2);
  assert.equal(await page.evaluate(() => window.T.consumirAvisoLista()), 'Esta ficha não existe mais.');

  // 9. Reexecutar (multi-select): list stays open while ticking, exclusives clear the others, button off with nothing ticked,
  //    one call with the list, the ticks survive redraws and the list closes with Esc / outside tap
  const ETAPAS = ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado'];
  await page.evaluate((et) => { window.monta('analise_pronta'); window.dados.coleta = Object.fromEntries(et.map((k) => [k, { status: 'concluida' }])); window.redesenha(); }, ETAPAS);
  assert.equal(await txt('#aReex .pk-val'), 'Escolha as etapas');
  assert.equal(await page.isDisabled('[data-act="reexecutar"]'), true);
  assert.equal(await page.isHidden('#aReex-l'), true);
  assert.ok((await page.locator('.pk-note').innerText()).startsWith('Coleta: busca automática'));
  await page.click('#aReex');
  assert.equal(await page.getAttribute('#aReex', 'aria-expanded'), 'true');
  await page.click('.pk-multi .pk-opt[data-v="setor"]');
  await page.click('.pk-multi .pk-opt[data-v="mercado"]');
  assert.equal(await page.getAttribute('#aReex', 'aria-expanded'), 'true', 'stays open while ticking');
  assert.equal(await page.getAttribute('.pk-multi .pk-opt[data-v="setor"]', 'aria-checked'), 'true');
  assert.equal(await txt('#aReex .pk-val'), 'Setor, Mercado');
  assert.equal(await page.isDisabled('[data-act="reexecutar"]'), false);
  await page.evaluate(() => window.redesenha()); // a snapshot arrives: ticks and open list survive
  assert.equal(await page.getAttribute('.pk-multi .pk-opt[data-v="setor"]', 'aria-checked'), 'true');
  assert.equal(await page.getAttribute('#aReex', 'aria-expanded'), 'true');
  await page.click('.pk-multi .pk-opt[data-v="sintese"]');
  assert.equal(await txt('#aReex .pk-val'), 'Síntese');
  assert.equal(await page.locator('.pk-multi .pk-opt[aria-checked="true"]').count(), 1);
  await page.click('.pk-multi .pk-opt[data-v="setor"]');
  assert.equal(await page.getAttribute('.pk-multi .pk-opt[data-v="sintese"]', 'aria-checked'), 'false');
  await page.click('.pk-multi .pk-opt[data-v="setor"]'); // untick: nothing left
  assert.equal(await page.isDisabled('[data-act="reexecutar"]'), true);
  await page.click('.pk-multi .pk-opt[data-v="setor"]');
  await page.click('.pk-multi .pk-opt[data-v="empresa_digital"]');
  await page.keyboard.press('Escape');
  assert.equal(await page.getAttribute('#aReex', 'aria-expanded'), 'false');
  assert.equal(await txt('#aReex .pk-val'), 'Presença digital, Setor');
  await page.click('[data-act="reexecutar"]');
  assert.deepEqual((await chamadas()).at(-1), ['f1', 'reexecutar', { alvo: ['empresa_digital', 'setor'] }]);
  assert.equal(await txt('[data-act="reexecutar"]'), 'Aguarde…');
  await page.evaluate(() => window.pendente.res({ ok: true }));
  await page.waitForFunction(() => document.querySelector('[data-act="reexecutar"]')?.textContent === 'Reexecutar');
  assert.equal(await txt('#aReex .pk-val'), 'Escolha as etapas', 'ticks cleared after success');
  // Refused: the ticks stay so the person can retry
  await page.click('#aReex'); await page.click('.pk-multi .pk-opt[data-v="mercado"]'); await page.keyboard.press('Escape');
  await page.click('[data-act="reexecutar"]');
  await page.evaluate(() => window.pendente.rej({ details: { codigo: 'parametro_invalido', campo: 'alvo' } }));
  await page.waitForSelector('[role="alert"]');
  assert.equal(await txt('.acaoerr span'), 'O valor de Reexecutar não foi aceito.');
  assert.equal(await txt('#aReex .pk-val'), 'Mercado');
  // Outside tap closes the list; opening the door selector closes it too
  await page.click('#aReex');
  await page.mouse.click(2, 2);
  assert.equal(await page.getAttribute('#aReex', 'aria-expanded'), 'false');
  await page.click('#aReex'); await page.click('#aPorta');
  assert.equal(await page.getAttribute('#aReex', 'aria-expanded'), 'false');
  assert.equal(await page.getAttribute('#aPorta', 'aria-expanded'), 'true');

  console.log('test-admin-acoes-dom: ok');
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
