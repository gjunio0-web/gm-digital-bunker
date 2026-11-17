// Labels of the three events that acaoAdmin writes (spec 05 §5.4; guide §5.2.1): reexecucao {alvos},
// porta_decidida {de, para} and editada {secao, baseadaEm, versao}, with the detail the function really writes
// and with an empty or odd detail (older events). Run: node scripts/test-admin-eventos.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'eventos-'));
try {
  const out = join(dir, 'detalhe.mjs');
  await build({ entryPoints: ['src/admin/leads/detalhe.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  const { eventoTxt } = await import(pathToFileURL(out).href);
  const d = { f: {}, coleta: {}, eventos: [], analises: [] };
  const txt = (tipo, detalhe) => eventoTxt({ em: null, tipo, detalhe }, d);

  // reexecucao
  assert.equal(txt('reexecucao', { alvos: ['sintese'] }), 'Reexecução · Síntese');
  assert.equal(txt('reexecucao', { alvos: ['qualificacao'] }), 'Reexecução · Qualificação');
  assert.equal(txt('reexecucao', { alvos: ['setor'] }), 'Reexecução · Setor');
  assert.equal(txt('reexecucao', { alvos: ['empresa_digital', 'empresa_registro', 'mercado'] }), 'Reexecução · Presença digital, Registro, Mercado');
  assert.equal(txt('reexecucao', { alvos: ['empresa_futura'] }), 'Reexecução · empresa_futura');
  assert.equal(txt('reexecucao', {}), 'Reexecução');
  assert.equal(txt('reexecucao', undefined), 'Reexecução');
  assert.equal(txt('reexecucao', { alvos: [] }), 'Reexecução');
  assert.equal(txt('reexecucao', { alvos: 'setor' }), 'Reexecução');
  assert.equal(txt('reexecucao', { alvos: [null, 3, ''] }), 'Reexecução');

  // porta_decidida
  assert.equal(txt('porta_decidida', { de: 'projeto', para: 'conselho' }), 'Porta decidida · Projeto → Conselho');
  assert.equal(txt('porta_decidida', { de: null, para: 'workshop' }), 'Porta decidida · Workshop');
  assert.equal(txt('porta_decidida', { de: 'conselho', para: 'combinacao' }), 'Porta decidida · Conselho → Combinação');
  assert.equal(txt('porta_decidida', { de: 'workshop', para: 'nenhuma' }), 'Porta decidida · Workshop → Nenhuma');
  assert.equal(txt('porta_decidida', { de: 'x', para: 'conselho' }), 'Porta decidida · x → Conselho');
  assert.equal(txt('porta_decidida', {}), 'Porta decidida');
  assert.equal(txt('porta_decidida', undefined), 'Porta decidida');
  assert.equal(txt('porta_decidida', { de: 'projeto' }), 'Porta decidida');

  // editada
  assert.equal(txt('editada', { secao: 's2', baseadaEm: 'v1', versao: 'v2' }), 'Editada · s2 A empresa → v2');
  assert.equal(txt('editada', { secao: 's7', baseadaEm: 'v3', versao: 'v4' }), 'Editada · s7 Preparação da primeira conversa → v4');
  assert.equal(txt('editada', { secao: 's9', versao: 'v2' }), 'Editada · s9 → v2');
  assert.equal(txt('editada', { versao: 'v2' }), 'Editada · v2');
  assert.equal(txt('editada', { secao: 's2' }), 'Editada · s2 A empresa');
  assert.equal(txt('editada', {}), 'Editada');
  assert.equal(txt('editada', undefined), 'Editada');
  assert.equal(txt('editada', { secao: 3, versao: null }), 'Editada');

  // coleta_etapa: "dado anterior" only when detalhe.preservado is not empty (spec 05 §5.4)
  const dc = { ...d, coleta: { empresa_digital: { confianca: { grau: 'alta' } } } };
  const ce = (detalhe) => eventoTxt({ em: null, tipo: 'coleta_etapa', detalhe }, dc);
  assert.equal(ce({ etapa: 'empresa_digital', status: 'concluida', preservado: ['apollo'] }), 'Coleta · Presença digital: concluída, confiança alta · dado anterior');
  assert.equal(ce({ etapa: 'empresa_pessoas', status: 'falhou', preservado: ['etapa'] }), 'Coleta · Pessoas: falhou · dado anterior');
  assert.equal(ce({ etapa: 'empresa_digital', status: 'concluida' }), 'Coleta · Presença digital: concluída, confiança alta');
  assert.equal(ce({ etapa: 'empresa_digital', status: 'concluida', preservado: [] }), 'Coleta · Presença digital: concluída, confiança alta');
  assert.equal(ce({ etapa: 'empresa_pessoas', status: 'falhou' }), 'Coleta · Pessoas: falhou');

  console.log('test-admin-eventos: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
