import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valida, normalizaSite, ehRobo, retornoPara } from '../valida.js';

const base = { nome: 'Ana', empresa: 'ACME', cargo: 'ceo', email: 'Ana@Acme.com.br', site: '', mensagem: '', lang: 'pt-BR' };

test('accepts a complete submission and normalizes e-mail', () => {
  const r = valida(base);
  assert.equal(r.ok, true);
  assert.equal(r.dados.email, 'ana@acme.com.br');
});
test('rejects missing required fields and unknown role', () => {
  const r = valida({ ...base, nome: ' ', cargo: 'king', email: 'x' });
  assert.deepEqual(r.erros, ['nome', 'cargo', 'email']);
});
test('website: optional, scheme added, invalid rejected', () => {
  assert.equal(normalizaSite(''), '');
  assert.equal(normalizaSite('www.acme.com.br'), 'https://www.acme.com.br');
  assert.equal(normalizaSite('acme'), null);
  assert.equal(normalizaSite('ftp://acme.com'), null);
  assert.deepEqual(valida({ ...base, site: 'not a site' }).erros, ['site']);
});
test('length limits', () => {
  assert.deepEqual(valida({ ...base, mensagem: 'x'.repeat(4001) }).erros, ['mensagem']);
});
test('unknown language falls back to pt-BR; return path is fixed', () => {
  assert.equal(valida({ ...base, lang: 'fr' }).dados.lang, 'pt-BR');
  assert.equal(retornoPara('en'), '/en/contact/');
  assert.equal(retornoPara('//evil.com'), '/contato/');
});
test('honeypot', () => {
  assert.equal(ehRobo({ 'empresa-site': 'x' }), true);
  assert.equal(ehRobo({}), false);
});
