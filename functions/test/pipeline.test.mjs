// config/pipeline defaults: merge over the stored document, and the seed's missing-field list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinaPipeline } from '../lib/pipeline.js';
import { camposAusentes } from '../lib/seedCampos.js';
import { PIPELINE_PADRAO } from '../lib/config.js';

test('missing document or fontes block falls back to the defaults', () => {
  assert.deepEqual(combinaPipeline({}), PIPELINE_PADRAO);
  assert.deepEqual(combinaPipeline({ prazoGuardaDias: 60 }).fontes, PIPELINE_PADRAO.fontes);
  assert.equal(combinaPipeline({ prazoGuardaDias: 60 }).prazoGuardaDias, 60);
});

test('fontes merges per provider and per field', () => {
  const p = combinaPipeline({ fontes: { apollo: { ativo: false } } });
  assert.deepEqual(p.fontes.apollo, { ativo: false, maxChamadasPorFicha: 1 });
  assert.deepEqual(p.fontes.brasilapi, { ativo: true, maxChamadasPorFicha: 3 });
});

test('seed adds only what is missing and never overwrites', () => {
  const atual = { ...PIPELINE_PADRAO, prazoGuardaDias: 60 };
  delete atual.fontes;
  assert.deepEqual(camposAusentes(PIPELINE_PADRAO, atual), { fontes: PIPELINE_PADRAO.fontes });
  const parcial = { ...PIPELINE_PADRAO, fontes: { apollo: { ativo: false } } };
  assert.deepEqual(Object.keys(camposAusentes(PIPELINE_PADRAO, parcial)).sort(),
    ['fontes.apify', 'fontes.apollo.maxChamadasPorFicha', 'fontes.brasilapi', 'fontes.hunter']);
  assert.deepEqual(camposAusentes(PIPELINE_PADRAO, PIPELINE_PADRAO), {});
});

test('pesosQualificacao.paginasOrigem: seed adds the list when missing; a stored list replaces the default', async () => {
  const { camposAusentes } = await import('../lib/seedCampos.js');
  const { combinaPipeline } = await import('../lib/pipeline.js');
  const { PIPELINE_PADRAO } = await import('../lib/config.js');
  const guardado = { pesosQualificacao: { versao: '1', limiarQuadrante: 15 } };
  const faltam = camposAusentes(PIPELINE_PADRAO, guardado);
  assert.equal(faltam['pesosQualificacao.paginasOrigem'].length, 14);
  assert.equal(faltam['pesosQualificacao.limiarQuadrante'], undefined);
  const proprio = combinaPipeline({ pesosQualificacao: { paginasOrigem: [{ pagina: 'contato', pontos: 2 }] } });
  assert.deepEqual(proprio.pesosQualificacao.paginasOrigem, [{ pagina: 'contato', pontos: 2 }]);
  assert.equal(combinaPipeline({}).pesosQualificacao.paginasOrigem.length, 14);
});

test('modelos and esforco: per stage, merged per entry; reparar and corrigir inherit', async () => {
  const { modeloDe, esforcoDe, esforcoApi, chaveDesenho } = await import('../lib/modelos.js');
  const p = combinaPipeline({ modelos: { enquadrar: 'claude-sonnet-5-5', montar_analise: 'claude-haiku-5-5' }, esforco: { montar_analise: 'medio' } });
  assert.equal(p.modelos.coleta, '');
  assert.equal(modeloDe(p, 'enquadrar'), 'claude-sonnet-5-5');
  assert.equal(modeloDe(p, 'reparar', 'enquadrar'), 'claude-sonnet-5-5');
  assert.equal(modeloDe(p, 'corrigir'), 'claude-haiku-5-5');
  assert.equal(esforcoDe(p, 'corrigir'), 'medio');
  assert.equal(esforcoDe(p, 'enquadrar'), 'padrao');
  assert.equal(esforcoApi('baixo'), 'low');
  assert.equal(esforcoApi('padrao'), undefined);
  assert.throws(() => esforcoDe(combinaPipeline({ esforco: { revisor: 'low' } }), 'revisor'), /invalid value/);
  assert.equal(
    chaveDesenho({ enquadrar: { modelo: 'claude-haiku-5-5', esforco: 'medio' }, preparar_conversa: { modelo: 'claude-haiku-5-5', esforco: 'medio' }, montar_analise: { modelo: 'claude-sonnet-5-5', esforco: 'alto' } }),
    'haiku-5-5_medio__haiku-5-5_medio__sonnet-5-5_alto',
  );
});

test('migration of config/pipeline: old fields to modelos/esforco, idempotent', async () => {
  const { planoMigracao } = await import('../lib/migracao.js');
  const { ETAPAS_MODELO } = await import('../lib/config.js');
  const antigo = { modeloColeta: 'claude-haiku-5-5', modeloSintese: 'claude-sonnet-5-5', modeloRevisor: 'claude-sonnet-5-5', esforcoSintese: 'medium', prazoGuardaDias: 60 };
  const { campos, antigos } = planoMigracao(antigo, ETAPAS_MODELO, PIPELINE_PADRAO);
  assert.deepEqual(antigos, ['modeloColeta', 'modeloSintese', 'modeloRevisor', 'esforcoSintese']);
  assert.equal(campos['modelos.qualificar'], 'claude-haiku-5-5');
  assert.equal(campos['modelos.montar_analise'], 'claude-sonnet-5-5');
  assert.equal(campos['modelos.reparar'], null);
  assert.equal(campos['esforco.enquadrar'], 'medio');
  assert.equal(campos['esforco.revisor'], 'baixo');
  assert.equal(campos['esforco.coleta'], 'padrao');
  assert.equal(campos.limiarReparo, 0.02);
  assert.equal(campos.correcaoAtiva, true);
  // Applied: nothing left to do.
  const migrado = { prazoGuardaDias: 60, modelos: {}, esforco: {}, limiarReparo: 0.02, correcaoAtiva: true };
  for (const [k, v] of Object.entries(campos)) {
    const [g, e] = k.split('.');
    if (e) migrado[g][e] = v; else migrado[g] = v;
  }
  assert.deepEqual(planoMigracao(migrado, ETAPAS_MODELO, PIPELINE_PADRAO), { campos: {}, antigos: [] });
});

test('uso per call: cache apart, totals summed, prompt for the ficha as before', async () => {
  const { usoChamada, totalDe, promptDe } = await import('../lib/uso.js');
  const { PRECOS_INICIAIS } = await import('../lib/precosIniciais.js');
  const a = usoChamada(PRECOS_INICIAIS, 'claude-sonnet-5-5', 'medio', { input_tokens: 1000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0, output_tokens: 2000 }, 1500);
  assert.deepEqual(a, { modelo: 'claude-sonnet-5-5', esforco: 'medio', tokensEntrada: 1000, tokensSaida: 2000, cacheLidos: 10_000, cacheEscritos: 0, duracaoMs: 1500, usdEstimado: 0.023, usdSemCache: 0.042, versaoPrecos: '1' });
  const b = usoChamada(PRECOS_INICIAIS, 'claude-sonnet-5-5', 'medio', { input_tokens: 0, cache_creation_input_tokens: 4000, output_tokens: 0 }, 500);
  const t = totalDe([a, b]);
  assert.equal(t.cacheEscritos, 4000);
  assert.equal(t.duracaoMs, 2000);
  assert.equal(t.usdEstimado, 0.033);
  assert.equal(promptDe([a, b]), 15_000);
});

test('run parameters of a synthesis re-run (phase B2): validated, put over the configuration, inherited by reparar and corrigir', async () => {
  const { problemasDosParametros, comParametros, modeloDe, esforcoDe } = await import('../lib/modelos.js');
  const conhecidos = ['claude-sonnet-5-5', 'claude-haiku-5-5'];
  const c = { modelos: { preparar_conversa: 'claude-haiku-5-5', montar_analise: 'claude-haiku-5-5' } };
  assert.deepEqual(problemasDosParametros(c, conhecidos), []);
  assert.equal(problemasDosParametros({ modelos: { revisor: 'claude-haiku-5-5' } }, conhecidos).length, 1);
  assert.equal(problemasDosParametros({ esforco: { enquadrar: 'high' } }, conhecidos).length, 1);
  const p = combinaPipeline({ modelos: { enquadrar: 'claude-sonnet-5-5', preparar_conversa: 'claude-sonnet-5-5', montar_analise: 'claude-sonnet-5-5', revisor: 'claude-sonnet-5-5' }, esforco: { montar_analise: 'medio' } });
  const q = comParametros(p, c);
  assert.equal(modeloDe(q, 'montar_analise'), 'claude-haiku-5-5');
  assert.equal(modeloDe(q, 'corrigir'), 'claude-haiku-5-5');
  assert.equal(modeloDe(q, 'reparar', 'preparar_conversa'), 'claude-haiku-5-5');
  assert.equal(modeloDe(q, 'revisor'), 'claude-sonnet-5-5');
  assert.equal(esforcoDe(q, 'montar_analise'), 'medio');
  assert.equal(comParametros(p, null), p);
});
