// Unit tests of the phase B2 report: rounds by creation time, design by model, and the measures of one round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desenhoDe, rodadaDe } from '../scripts/b2-rodadas.mjs';
import { relatorio } from '../scripts/relatorio-b2.mjs';

const CAPAL = 'p6N6ZaljSCClrxgkRMg0';
const uso = (modelo, usd) => ({
  enquadrar: { modelo: 'claude-sonnet-5-5', esforco: 'medio', cacheLidos: 0, cacheEscritos: 10, duracaoMs: 20_000, usdEstimado: 0.2 },
  montar_analise: { modelo, esforco: 'medio', cacheLidos: 0, cacheEscritos: 10, duracaoMs: 30_000, usdEstimado: usd },
  reparar: [{ origem: 'montar_analise', modelo, esforco: 'medio', duracaoMs: 5_000, usdEstimado: 0.01 }],
  total: { usdEstimado: 0.2 + usd + 0.01 },
});
const base = (id, criadaEm, modelo, extra = {}) => ({
  id, n: Number(id.slice(1)), criadaEm, origem: 'reexecucao', uso: uso(modelo, 0.3),
  enquadramento: { estruturaTecnologia: { categoria: 'enxuta' }, escopo: 'aprovado', portaProvavel: 'conselho', detalhe: { escopo: { resultadoDeclarado: 'aprovado', itensRemovidos: [] }, riscosDoLead: [{ risco: 'outro', origem: 'coleta' }], leituraDoPotencial: { direcao: 'crescer', confianca: 'media' } } },
  verificacao: {
    status: 'com_pendencias',
    pendencias: [{ tipo: 'mecanica', regra: 'secao_curta' }, { tipo: 'mecanica', regra: 'sigla' }, { tipo: 'escopo', regra: 'limite-4' }, { tipo: 'lastro_interno' }],
    reparos: [{ regra: 'sigla', aceito: false }, { regra: 'termo_vetado', aceito: true }],
    checklist: [{ regra: 'limite-4', resultado: 'violado' }, { regra: 'limite-1', resultado: 'conforme' }],
    avisos: [],
  },
  ...extra,
});
const corr = (id, baseadaEm, criadaEm) => ({
  id, n: Number(id.slice(1)), criadaEm, origem: 'correcao', baseadaEm,
  uso: { corrigir: { modelo: 'claude-sonnet-5-5', esforco: 'medio', duracaoMs: 40_000, usdEstimado: 0.25 }, total: { usdEstimado: 0.25 } },
  correcao: { tratamentos: [{ tratamento: 'corrigida' }, { tratamento: 'mantida' }] },
  verificacao: { status: 'pronta', pendencias: [] },
});

test('rodadaDe and desenhoDe: windows of 8 and 9/11, correction takes its base, fifth ficha v1 is automatic', () => {
  const vs = [base('v1', '2026-11-08T23:20:00Z', 'claude-sonnet-5-5'), corr('v2', 'v1', '2026-11-09T16:00:00Z')];
  assert.equal(rodadaDe(CAPAL, vs[0], vs), 'R1');
  assert.equal(rodadaDe(CAPAL, vs[1], vs), 'R1');
  assert.equal(rodadaDe(CAPAL, base('v3', '2026-11-09T16:05:00Z', 'x'), vs), 'R1c');
  assert.equal(rodadaDe(CAPAL, base('v4', '2026-11-09T00:20:00Z', 'x'), vs), 'diagnostico');
  assert.equal(rodadaDe(CAPAL, base('v5', '2026-11-07T10:00:00Z', 'x'), vs), 'anterior');
  assert.equal(rodadaDe('xyE0CrEYLD3geFZBsaDg', { id: 'v1', criadaEm: '2026-11-08T22:00:00Z' }, []), 'automatica');
  assert.equal(desenhoDe('claude-haiku-5-5'), 'C');
  assert.equal(desenhoDe('claude-sonnet-5-5'), 'A');
});

test('relatorio: measures of a round, the per-design block and the mechanical criterion', () => {
  const versoes = [
    base('v1', '2026-11-08T23:15:00Z', 'claude-sonnet-5-5'),
    base('v2', '2026-11-08T23:30:00Z', 'claude-haiku-5-5'),
    base('v3', '2026-11-09T16:00:00Z', 'claude-sonnet-5-5'),
    corr('v4', 'v3', '2026-11-09T16:03:00Z'),
    base('v5', '2026-11-09T16:15:00Z', 'claude-haiku-5-5'),
    corr('v6', 'v5', '2026-11-09T16:18:00Z'),
    base('v7', '2026-11-09T01:00:00Z', 'claude-sonnet-5-5'),
  ];
  const graduadas = { v1: { pontos: 75, grau: 'A' }, v2: { pontos: 77, grau: 'A' }, v3: { pontos: 70, grau: 'A' }, v5: { pontos: 77, grau: 'A' } };
  const r = relatorio([{ id: CAPAL, empresa: 'Capal', versoes, graduadas }], 'agora');
  assert.equal(r.rodadas, 4);
  assert.ok(r.md.includes('| rodada 1 com correção | A | v3 → v4 | 70 | A |'));
  // Before the repair: sent sigla and termo_vetado, plus secao_curta (no repair); after: secao_curta and sigla.
  assert.ok(r.md.includes('| secao_curta 1, sigla 1, termo_vetado 1 | secao_curta 1, sigla 1 | 1 / 1 |'));
  assert.ok(r.md.includes('| 1 / 1 | 0 | US$ 0.7600 |'));
  // Design A: points 75 and 70 (range 5); design C: 77 and 77 (range 0) – (a) holds; scope 1 and 1 – (b) holds.
  assert.ok(r.md.includes('| Capal | 5 / 0 | atende | 1–1 / 1, 1 | atende |'));
  assert.ok(r.md.includes('**Resultado: critério atendido.**'));
  assert.ok(!r.md.includes('v7'));
});

test('retest report: invented marks, repairs by rule, treatments kept by the code, totals', async () => {
  const { marcasInventadas, medidasDaRodada } = await import('../scripts/relatorio-reteste.mjs');
  const fontes = { setor: 0, mercado: 3, empresa_digital: 2 };
  const versao = {
    secoes: { s3: { corpo: 'Setor [F:setor:1].' }, s4: { corpo: 'TAM [F:mercado:2]; outra [F:mercado:5].' } },
    rascunhoResposta: { corpo: 'Olá' }, conversa: {},
    enquadramento: { detalhe: { estruturaTecnologia: { evidencias: [{ etapa: 'empresa_digital', fonteIdx: 1 }, { etapa: 'empresa_digital', fonteIdx: 4 }] } } },
  };
  assert.deepEqual(marcasInventadas(versao, fontes), ['setor:1', 'mercado:5', 'empresa_digital:4']);
  const base = {
    id: 'v1', secoes: {}, verificacao: { reparos: [{ regra: 'sigla', aceito: true }, { regra: 'marca_sem_destino', aceito: false }], avisos: [] },
    uso: { total: { usdEstimado: 0.5, usdSemCache: 0.7, duracaoMs: 100000 } },
  };
  const correcao = {
    id: 'v2', ...versao,
    verificacao: { status: 'com_pendencias', reparos: [], pendencias: [{ tipo: 'mecanica', regra: 'marca_sem_destino' }, { tipo: 'lastro', tratamento: 'corrigida' }] },
    correcao: { tratamentos: [{ tratamento: 'corrigida' }, { tratamento: 'mantida', razao: 'x' }, { tratamento: 'mantida', razao: 'bloco estruturado não editável pela correção' }] },
    uso: { total: { usdEstimado: 0.1, usdSemCache: 0.2, duracaoMs: 50000 } },
  };
  const m = medidasDaRodada(base, correcao, [{ aceito: true }, { aceito: false, motivo: 'mudança fora dos trechos de 3.1%' }], fontes);
  assert.equal(m.versoes, 'v1 → v2');
  assert.equal(m.inventadas.length, 3);
  assert.deepEqual(m.pedidos, { sigla: 1, marca_sem_destino: 1 });
  assert.deepEqual(m.rejeitados, { marca_sem_destino: 1 });
  assert.deepEqual([m.chamadasReparo, m.chamadasRejeitadasLimiar], [2, 1]);
  assert.deepEqual([m.corrigidas, m.mantidas, m.mantidasPeloCodigo], [1, 1, 1]);
  assert.deepEqual(m.mecanicas, { marca_sem_destino: 1 });
  assert.equal(m.status, 'com_pendencias');
  assert.ok(Math.abs(m.usd - 0.6) < 1e-9 && Math.abs(m.usdSemCache - 0.9) < 1e-9);
  assert.equal(m.duracaoMs, 150000);
});
