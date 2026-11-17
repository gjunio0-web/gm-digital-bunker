// Where an erro of a failed triagem step may be recorded (spec 01 v0.39, section 4.1): the pure condition, and a check
// that the three handlers that run the triagem go through it (the emulator tests exercise the transaction itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { erroCabe } from '../lib/erroTriagem.js';

test('erroCabe: qualificar only in coleta_minima; graduar only in qualificada without lead', () => {
  const ESTADOS = ['recebida', 'coleta_minima', 'qualificada', 'descartada', 'resposta_breve', 'coletando', 'coletada', 'sintetizando', 'analise_pronta', 'arquivada'];
  for (const estado of ESTADOS) {
    for (const lead of [undefined, null, { momento: 'triagem' }]) {
      assert.equal(erroCabe('qualificar', { estado, lead }), estado === 'coleta_minima', `qualificar ${estado}`);
      assert.equal(erroCabe('graduar', { estado, lead }), estado === 'qualificada' && !lead, `graduar ${estado} lead=${JSON.stringify(lead)}`);
    }
  }
});

test('erroCabe: other steps are not restricted; a missing ficha records nothing', () => {
  for (const etapa of ['coleta_minima', 'coletar', 'sintetizar', 'verificar', 'etapa_futura']) {
    assert.equal(erroCabe(etapa, { estado: 'coletando' }), true, etapa);
    assert.equal(erroCabe(etapa, { estado: 'qualificada', lead: { a: 1 } }), true, etapa);
  }
  assert.equal(erroCabe('graduar', undefined), false);
  assert.equal(erroCabe('coletar', undefined), false);
});

test('the three triagem handlers record erro through gravaErro, never by a direct write', () => {
  for (const f of ['coletaMinimaCorpo', 'retomarTriagem', 'retomarColetaMinima']) {
    const src = readFileSync(new URL(`../src/${f}.ts`, import.meta.url), 'utf8');
    assert.match(src, /await gravaErro\(ref, etapa, mensagem\)/, f);
    assert.doesNotMatch(src, /ref\.update\(\{ erro:/, f);
  }
});

test('receberFicha records an e-mail failure as the email_falhou event and never writes erro on the ficha (spec 01 v0.42)', () => {
  const src = readFileSync(new URL('../src/receberFicha.ts', import.meta.url), 'utf8');
  assert.ok(src.includes("tipo: 'email_falhou'"));
  assert.ok(!/\berro:\s*\{/.test(src), 'no write of an erro object');
  assert.ok(!src.includes('ref.update('), 'no update of the ficha after the e-mails');
});
