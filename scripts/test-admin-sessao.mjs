// Re-emission of the sign-in state must not remount the view (src/admin/sessao.ts). Run: node scripts/test-admin-sessao.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'sessao-'));
try {
  const out = join(dir, 's.mjs');
  await build({ entryPoints: ['src/admin/sessao.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  const { mesmoUsuarioRoteado: m } = await import(pathToFileURL(out).href);
  assert.equal(m(null, 'u1'), false, 'first sign-in routes');
  assert.equal(m('u1', 'u1'), true, 'same user again: no remount');
  assert.equal(m('u1', 'u2'), false, 'another user routes');
  assert.equal(m('u1', null), false);
  assert.equal(m('u1', undefined), false);
  assert.equal(m(null, null), false);
  // The shell wires it: the check comes before the role read, the uid is set before routing and cleared on sign-out and on no access
  const app = readFileSync('src/admin/app.ts', 'utf8');
  const i = app.indexOf('onAuthStateChanged(auth, async');
  const corpo = app.slice(i, app.indexOf('async function lerPapel'));
  const pos = (t) => { const k = corpo.indexOf(t); assert.ok(k >= 0, 'missing in the shell: ' + t); return k; };
  assert.ok(pos('if (mesmoUsuarioRoteado(uidRoteado, user.uid)) return;') < pos('verificarAcesso('));
  assert.ok(pos('uidRoteado = user.uid;') < pos('rotear(db);'));
  assert.equal((corpo.match(/uidRoteado = null;/g) ?? []).length, 2);
  console.log('test-admin-sessao: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }
