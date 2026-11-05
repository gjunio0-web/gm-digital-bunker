// Method files: fixed order, publication summary, version and clean-tree checks, section filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ARQUIVOS_METODO, exigeLimpo, filtraSecoes, resumeArquivos, versaoValida } from '../lib/metodoArquivos.js';
import { localDe } from '../lib/metodo.js';

const raiz = new URL('../../metodo/', import.meta.url);
const reais = ARQUIVOS_METODO.map((nome) => ({ nome, conteudo: readFileSync(new URL(nome, raiz), 'utf8') }));

test('summary keeps the fixed order whatever the input order, with bytes and SHA-256', () => {
  const r = resumeArquivos([...reais].reverse());
  assert.deepEqual(r.map((a) => a.nome), [...ARQUIVOS_METODO]);
  for (const a of r) {
    const buf = readFileSync(new URL(a.nome, raiz));
    assert.equal(a.bytes, buf.length);
    assert.equal(a.sha256, createHash('sha256').update(buf).digest('hex'));
  }
});

test('summary refuses a missing, extra or renamed file', () => {
  assert.throws(() => resumeArquivos(reais.slice(1)));
  assert.throws(() => resumeArquivos([...reais, { nome: 'outro.md', conteudo: '' }]));
  assert.throws(() => resumeArquivos(reais.map((a, i) => (i ? a : { ...a, nome: 'Glossario.md' }))));
});

test('version must be a short commit hash; uncommitted changes are refused', () => {
  assert.equal(versaoValida('afe92ba'), true);
  assert.equal(versaoValida('../x'), false);
  assert.throws(() => exigeLimpo(' M metodo/glossario.md\n'));
  assert.doesNotThrow(() => exigeLimpo(''));
});

test('section filter keeps the header and the chosen numbered sections only', () => {
  const mapa = reais.find((a) => a.nome === 'mapa-alavancas.md').conteudo;
  const f = filtraSecoes(mapa, [1, 2, 3, 4]);
  assert.match(f, /^---\ntitulo: Mapa de Alavancas/);
  for (const n of [1, 2, 3, 4]) assert.match(f, new RegExp(`^## ${n}\\. `, 'm'));
  for (const n of [5, 10]) assert.doesNotMatch(f, new RegExp(`^## ${n}\\. `, 'm'));
  assert.ok(f.length < mapa.length);
});

test('section filter by part letter (glossary part B)', () => {
  const g = reais.find((a) => a.nome === 'glossario.md').conteudo;
  const f = filtraSecoes(g, ['B']);
  assert.match(f, /^## Parte B – /m);
  assert.doesNotMatch(f, /^## Parte A – /m);
  assert.doesNotMatch(f, /^## Parte C – /m);
});

test('storage path parsing', () => {
  assert.deepEqual(localDe('gs://gmdb-qualidade-metodo/metodo/abc1234/'), { bucket: 'gmdb-qualidade-metodo', prefixo: 'metodo/abc1234/' });
  assert.throws(() => localDe('metodo/abc1234/'));
});
