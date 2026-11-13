// Spec 02 v0.24 and spec 01 v0.23 (13/11/2026): numero_sem_fonte is a warning – recorded as a mechanical issue,
// it does not block analise_pronta nor count as an open issue in the analysis e-mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bloqueia, ehAviso } from '../lib/verificacao.js';
import { pendenciasEmAberto, prontaAposCorrecao } from '../lib/correcao.js';

const numero = { tipo: 'mecanica', regra: 'numero_sem_fonte', secao: 's4', trecho: 'R$ 8 a 17 bilhões.' };
const sigla = { tipo: 'mecanica', regra: 'sigla', secao: 's2', trecho: 'CNPJ' };

test('numero_sem_fonte is a warning; other mechanical rules and reviewer issues block (spec 02 v0.24, 4.1)', () => {
  assert.ok(ehAviso(numero) && !bloqueia(numero));
  assert.ok(!ehAviso(sigla) && bloqueia(sigla));
  // Only a mechanical issue of that rule is a warning.
  assert.ok(bloqueia({ tipo: 'lastro', regra: 'numero_sem_fonte', secao: 's4', trecho: 'x' }));
});

test('correction version: only numero_sem_fonte left is ready (spec 02 v0.24, 4.3)', () => {
  assert.equal(prontaAposCorrecao([numero, numero], [{ tratamento: 'corrigida' }, { tratamento: 'sem_alteracao' }]), true);
  assert.equal(prontaAposCorrecao([numero, sigla], [{ tratamento: 'corrigida' }]), false);
  assert.equal(prontaAposCorrecao([numero], [{ tratamento: 'mantida' }]), false);
  assert.equal(prontaAposCorrecao([], []), true);
});

test('e-mail count leaves out resolved issues and warnings (spec 01 v0.23, section 8, decision 3)', () => {
  const todas = [
    numero, sigla,
    { tipo: 'lastro', secao: 's2', trecho: 'a', tratamento: 'corrigida' },
    { tipo: 'tom', secao: 'rascunho', trecho: 'b', tratamento: 'sem_alteracao' },
    { tipo: 'hipotese', secao: 'enquadramento', trecho: 'c', tratamento: 'mantida' },
  ];
  assert.deepEqual(pendenciasEmAberto(todas).map((x) => x.regra ?? x.tipo), ['sigla', 'hipotese']);
  assert.equal(pendenciasEmAberto([numero]).length, 0);
});
