// The e-mail texts compiled into the functions must match the site's src/i18n/ui.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARGOS_ROTULO, TEXTOS } from '../lib/textos.generated.js';
import { CARGOS } from '../lib/validacao.js';
const { ui } = await import(new URL('../../src/i18n/ui.ts', import.meta.url).href);

test('confirmation texts come from ui.ts in both languages', () => {
  for (const lang of ['pt-BR', 'en']) {
    assert.equal(TEXTOS[lang].success, ui[lang].form.success);
    assert.equal(TEXTOS[lang].subject, ui[lang].emailConfirmacao.subject);
    assert.equal(TEXTOS[lang].footer, ui[lang].emailConfirmacao.footer);
  }
});

test('every accepted role has the Portuguese form label', () => {
  assert.deepEqual(CARGOS_ROTULO, ui['pt-BR'].form.roles);
  for (const c of CARGOS) assert.ok(CARGOS_ROTULO[c], `missing label for ${c}`);
});
