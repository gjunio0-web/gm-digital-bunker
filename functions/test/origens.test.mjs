// Allowed origins per Firebase project (CORS of acaoAdmin and of receberFicha).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGENS_POR_PROJETO } from '../lib/config.js';

test('gmdb-producao: the bare domain and www, both https, and nothing else', () => {
  assert.deepEqual([...ORIGENS_POR_PROJETO['gmdb-producao']], ['https://gmdigitalbunker.com.br', 'https://www.gmdigitalbunker.com.br']);
});

test('gmdb-qualidade: unchanged (the quality-env Netlify address and the local dev server)', () => {
  assert.deepEqual([...ORIGENS_POR_PROJETO['gmdb-qualidade']], ['https://quality-env--gm-digital-bunker.netlify.app', 'http://localhost:4321']);
});

test('no origin has a trailing slash, a path or a non-https scheme outside localhost', () => {
  for (const [projeto, lista] of Object.entries(ORIGENS_POR_PROJETO)) {
    for (const o of lista) {
      const u = new URL(o);
      assert.equal(u.origin, o, `${projeto}: ${o} is not a bare origin`);
      assert.ok(u.protocol === 'https:' || u.hostname === 'localhost', `${projeto}: ${o}`);
    }
  }
});
