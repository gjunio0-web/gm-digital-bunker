// Unit tests of the server-side validation (compiled output in lib/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valida, normalizaSite, normalizaPagina, ehRobo } from '../lib/validacao.js';

const base = { nome: ' Ana ', empresa: 'ACME', cargo: 'ceo', email: 'Ana@Acme.com.br', site: '', mensagem: '', lang: 'pt-BR', pagina: '/contato' };

test('keeps the original as received and normalizes apart', () => {
  const r = valida({ ...base, site: 'www.acme.com.br' });
  assert.equal(r.ok, true);
  assert.equal(r.original.nome, 'Ana');
  assert.equal(r.original.email, 'Ana@Acme.com.br');
  assert.equal(r.original.site, 'www.acme.com.br');
  assert.equal(r.normalizado.email, 'ana@acme.com.br');
  assert.equal(r.normalizado.site, 'https://www.acme.com.br');
  assert.equal(r.original.mensagem, null);
  assert.equal(r.pagina, '/contato');
});
test('rejects missing required fields and unknown role', () => {
  assert.deepEqual(valida({ ...base, nome: ' ', cargo: 'king', email: 'x' }).erros, ['nome', 'cargo', 'email']);
});
test('website: optional, scheme added, invalid rejected', () => {
  assert.equal(normalizaSite('acme'), null);
  assert.equal(normalizaSite('ftp://acme.com'), null);
  assert.deepEqual(valida({ ...base, site: 'not a site' }).erros, ['site']);
});
test('length limits', () => {
  assert.deepEqual(valida({ ...base, mensagem: 'x'.repeat(4001) }).erros, ['mensagem']);
  assert.deepEqual(valida({ ...base, nome: 'x'.repeat(121) }).erros, ['nome']);
});
test('language falls back to pt-BR; page must be a site path', () => {
  assert.equal(valida({ ...base, lang: 'fr' }).original.lang, 'pt-BR');
  assert.equal(normalizaPagina('//evil.com'), null);
  assert.equal(normalizaPagina('https://x.com/'), null);
  assert.equal(normalizaPagina('/en/contact'), '/en/contact');
});
test('honeypot', () => {
  assert.equal(ehRobo({ 'empresa-site': 'x' }), true);
  assert.equal(ehRobo({}), false);
});
