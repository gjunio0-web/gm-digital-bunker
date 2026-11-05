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
