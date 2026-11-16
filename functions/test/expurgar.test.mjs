// Pure parts of the controle cleanup in expurgar (spec 01 v0.34): which ids qualify and when a counter is old enough.
// The batch itself (sum into metricas + delete) runs in the emulator, in acaoAdmin-emulador.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controleVencido, diaDoControle } from '../lib/expurgar.js';

test('diaDoControle: only analises-aaaa-mm-dd with a real day', () => {
  assert.equal(diaDoControle('analises-2026-10-16'), '2026-10-16');
  assert.equal(diaDoControle('analises-2024-02-29'), '2024-02-29');
  for (const id of ['analises-2026-02-30', 'analises-2026-13-01', 'analises-2026-1-01', 'outro', 'x-analises-2026-10-16', 'analises-2026-10-16-x', 'analises-']) assert.equal(diaDoControle(id), null, id);
});

test('controleVencido: more than 30 days from the day of the id, in São Paulo time', () => {
  const agora = new Date('2026-11-16T15:00:00Z'); // 12h in São Paulo
  assert.equal(controleVencido('2026-10-16', agora), true); // 31 days
  assert.equal(controleVencido('2026-10-17', agora), false); // exactly 30 days
  assert.equal(controleVencido('2026-11-16', agora), false);
  // 01h UTC of the 17th is still the 16th in São Paulo: the day count does not advance yet.
  assert.equal(controleVencido('2026-10-17', new Date('2026-11-17T01:00:00Z')), false);
  assert.equal(controleVencido('2026-10-17', new Date('2026-11-17T04:00:00Z')), true);
});
