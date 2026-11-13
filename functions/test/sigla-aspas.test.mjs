// Rule sigla (spec 02 v0.16, 4.1): the long form in the same sentence is accepted even when a closing quote or a
// bold marker sits between the acronym and the parenthesis (GAT Logística, R1l, 13/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siglasSemExtenso } from '../lib/verificacao.js';

const aponta = (t) => siglasSemExtenso(t).includes('TI');

test('sigla: closing quote or bold between the acronym and the parenthesis is accepted', () => {
  assert.equal(aponta("a página lista a categoria genérica 'Analista de TI' (Analista de Tecnologia da Informação), sem vínculo."), false);
  assert.equal(aponta('a página lista a categoria genérica "Analista de TI" (Analista de Tecnologia da Informação), sem vínculo.'), false);
  assert.equal(aponta('a página lista a categoria genérica “Analista de TI” (Analista de Tecnologia da Informação), sem vínculo.'), false);
  assert.equal(aponta('a área de **TI** (tecnologia da informação) é enxuta.'), false);
});

test('sigla: still flagged without a long form, or with a quote not followed by a parenthesis', () => {
  assert.equal(aponta("a página lista a categoria genérica 'Analista de TI', sem vínculo."), true);
  assert.equal(aponta("a categoria 'Analista de TI' aparece no LinkedIn (sem vínculo verificável)."), true);
});
