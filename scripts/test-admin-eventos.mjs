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
  assert.equal(txt('reexecucao', { alvos: ['qualificacao'], apenasLimpouErro: true }), 'Reexecução · Qualificação (só limpou o erro)');
  assert.equal(txt('reexecucao', { alvos: ['qualificacao'], apenasLimpouErro: false }), 'Reexecução · Qualificação');
  assert.equal(txt('reexecucao', { alvos: ['qualificacao'], apenasLimpouErro: 'sim' }), 'Reexecução · Qualificação'); // only the boolean true counts
  assert.equal(txt('reexecucao', { apenasLimpouErro: true }), 'Reexecução (só limpou o erro)');
  assert.equal(txt('reexecucao', { alvos: ['qualificacao'] }), 'Reexecução · Qualificação');
  assert.equal(txt('reexecucao', { alvos: ['setor'] }), 'Reexecução · Setor');
  assert.equal(txt('reexecucao', { alvos: ['empresa_digital', 'empresa_registro', 'mercado'] }), 'Reexecução · Presença digital, Registro, Mercado');
  assert.equal(txt('reexecucao', { alvos: ['empresa_futura'] }), 'Reexecução · empresa_futura');
  assert.equal(txt('reexecucao', {}), 'Reexecução');
  assert.equal(txt('reexecucao', undefined), 'Reexecução');
  assert.equal(txt('reexecucao', { alvos: [] }), 'Reexecução');
  assert.equal(txt('reexecucao', { alvos: 'setor' }), 'Reexecução');
  assert.equal(txt('reexecucao', { alvos: [null, 3, ''] }), 'Reexecução');

  // reexecucao with the new target and the unchanged label of Síntese (also used in Coletando)
  assert.equal(txt('reexecucao', { alvos: ['coleta_minima'] }), 'Reexecução · Coleta mínima');
  assert.equal(txt('reexecucao', { alvos: ['coleta_minima'], apenasLimpouErro: true }), 'Reexecução · Coleta mínima (só limpou o erro)');

  // parada in Recebida (vigiar covers it since spec 01 v0.40)
  assert.equal(txt('parada', { estado: 'recebida', minutos: 45 }), 'Ficha parada · Recebida sem avanço por 45 minutos');

  // email_falhou: one event per destination, label plus the muted reminder (spec 05 §5.4; texts approved by Gon, 17/11/2026)
  const { eventoNota } = await import(pathToFileURL(out).href);
  assert.equal(txt('email_falhou', { destino: 'interessado' }), 'E-mail não enviado · interessado');
  assert.equal(txt('email_falhou', { destino: 'administrador' }), 'E-mail não enviado · administrador');
  assert.equal(txt('email_falhou', {}), 'E-mail não enviado');
  assert.equal(txt('email_falhou', undefined), 'E-mail não enviado');
  assert.equal(txt('email_falhou', { destino: 'outro' }), 'E-mail não enviado');
  const nota = (detalhe, tipo = 'email_falhou') => eventoNota({ em: null, tipo, detalhe });
  assert.equal(nota({ destino: 'interessado' }), 'A confirmação de recebimento não chegou a ele; não há reenvio automático, e a resposta é manual.');
  assert.equal(nota({ destino: 'administrador' }), 'O aviso de ficha nova não chegou; não há reenvio automático.');
  assert.equal(nota({}), null);
  assert.equal(nota(undefined), null);
  assert.equal(nota({ destino: 'outro' }), null);
  assert.equal(nota({ destino: 'interessado' }, 'parada'), null);
  // In the timeline: two events (both failed) show both labels with their own reminder, in the same list; no error chip or block
  const dd = { id: 'x', f: { estado: 'coleta_minima' }, coleta: {}, analises: [],
    eventos: [{ em: new Date(Date.UTC(2026, 10, 17, 15, 0)), tipo: 'email_falhou', detalhe: { destino: 'interessado' } },
              { em: new Date(Date.UTC(2026, 10, 17, 15, 0)), tipo: 'email_falhou', detalhe: { destino: 'administrador' } }] };
  const { corpoHTML } = await import(pathToFileURL(out).href);
  const h = corpoHTML(dd, null, new Date(Date.UTC(2026, 10, 17, 16, 0)));
  assert.ok(h.includes('E-mail não enviado · interessado<br><span class="mut">A confirmação de recebimento'));
  assert.ok(h.includes('E-mail não enviado · administrador<br><span class="mut">O aviso de ficha nova'));
  assert.ok(!h.includes('Erro no pipeline'));

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

  // custo_sem_preco: call identifier in Portuguese, unknown identifier as it comes (spec 05 §5.4)
  const cs = (chamada) => txt('custo_sem_preco', { chamada, modelo: 'claude-x-1' });
  for (const [id, nome] of [['qualificar', 'Qualificação'], ['empresa_digital', 'Presença digital'], ['empresa_registro', 'Registro'],
    ['empresa_pessoas', 'Pessoas'], ['empresa_noticias', 'Notícias'], ['setor', 'Setor'], ['mercado', 'Mercado']]) {
    assert.equal(cs(id), `Custo não estimado · ${nome} (claude-x-1) sem preço na tabela`);
  }
  assert.equal(cs('empresa_futura'), 'Custo não estimado · empresa_futura (claude-x-1) sem preço na tabela');

  console.log('test-admin-eventos: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
