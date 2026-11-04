// The e-mail texts compiled into the functions must match the site's src/i18n/ui.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXTOS } from '../lib/textos.generated.js';
const { ui } = await import(new URL('../../src/i18n/ui.ts', import.meta.url).href);

test('confirmation texts come from ui.ts in both languages', () => {
  for (const lang of ['pt-BR', 'en']) {
    assert.equal(TEXTOS[lang].success, ui[lang].form.success);
    assert.equal(TEXTOS[lang].subject, ui[lang].emailConfirmacao.subject);
    assert.equal(TEXTOS[lang].footer, ui[lang].emailConfirmacao.footer);
  }
});
