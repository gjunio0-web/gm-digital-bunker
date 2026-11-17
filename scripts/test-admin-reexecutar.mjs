// Reexecutar targets by state (spec 05 §5.7; spec 01 v0.40 to v0.45). Pure function alvosReexecutar: the single source of the
// selector rule for the action bar (phase 5). Run: node scripts/test-admin-reexecutar.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'reexecutar-'));
try {
  const out = join(dir, 'reexecutar.mjs');
  await build({ entryPoints: ['src/admin/leads/reexecutar.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  const { alvosReexecutar, etapaUsavel } = await import(pathToFileURL(out).href);

  const ETAPAS = ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado'];
  const c = { status: 'concluida' };
  const inteira = { status: 'falhou', preservado: { blocos: ['etapa'] } };
  const soBloco = { status: 'falhou', preservado: { blocos: ['apollo'] } };
  const falhou = { status: 'falhou' };
  const pendente = { status: 'pendente' };
  const exec = { status: 'executando' };
  const todas = (e) => Object.fromEntries(ETAPAS.map((k) => [k, e]));
  const alvos = (estado, erro, coleta) => alvosReexecutar(estado, erro, coleta).map((o) => o.alvo);
  const erro = { etapa: 'x' };

  // Usable stage: concluida, or falhou with the whole stage preserved; nao_aplicavel is not usable (spec 01 v0.45)
  assert.equal(etapaUsavel(c), true);
  assert.equal(etapaUsavel(inteira), true);
  for (const e of [soBloco, falhou, pendente, exec, { status: 'nao_aplicavel' }, { status: 'x' }, {}, undefined, null]) assert.equal(etapaUsavel(e), false, JSON.stringify(e));
  assert.equal(etapaUsavel({ status: 'falhou', preservado: { blocos: 'etapa' } }), false); // blocos must be a list
  assert.equal(etapaUsavel({ status: 'falhou', preservado: null }), false);

  // Recebida: only with erro; Coleta mínima alone, with the approved description
  assert.deepEqual(alvosReexecutar('recebida', erro, {}), [{ alvo: 'coleta_minima', rotulo: 'Coleta mínima', descricao: 'Recomeça a coleta mínima desde o início.', rodaJunto: false, exclusiva: true }]);
  assert.deepEqual(alvos('recebida', null, {}), []);
  assert.deepEqual(alvos('recebida', undefined), []);
  assert.deepEqual(alvos('recebida', { etapa: 'interrupcao:recebida' }, {}), ['coleta_minima']);

  // Coleta mínima with erro: not completed minimal stages, or Qualificação when both are usable (any erro.etapa)
  assert.deepEqual(alvos('coleta_minima', erro, { empresa_digital: c, empresa_registro: c }), ['qualificacao']);
  for (const et of ['qualificar', 'coleta_minima', 'interrupcao:coleta_minima', 'coletarMinima']) {
    assert.deepEqual(alvos('coleta_minima', { etapa: et }, { empresa_digital: c, empresa_registro: c }), ['qualificacao'], et);
    assert.deepEqual(alvos('coleta_minima', { etapa: et }, { empresa_digital: c, empresa_registro: inteira }), ['empresa_registro', 'qualificacao'], et); // falhou stays a target even when usable
  }
  assert.deepEqual(alvos('coleta_minima', erro, { empresa_digital: c, empresa_registro: falhou }), ['empresa_registro']);
  assert.deepEqual(alvos('coleta_minima', erro, { empresa_digital: pendente, empresa_registro: exec }), ['empresa_digital', 'empresa_registro']);
  assert.deepEqual(alvos('coleta_minima', erro, { empresa_digital: c, empresa_registro: pendente }), ['empresa_registro']); // one pendente: no Qualificação
  assert.deepEqual(alvos('coleta_minima', erro, { empresa_digital: c }), []); // missing document: not usable, not offered
  assert.deepEqual(alvos('coleta_minima', erro, {}), []);
  // falhou with preservado of one block only is not usable and stays a target of the stage
  assert.deepEqual(alvos('coleta_minima', erro, { empresa_digital: c, empresa_registro: soBloco }), ['empresa_registro']);
  // falhou with the whole stage preserved is both a target of the stage and, with the other usable, enables Qualificação
  assert.deepEqual(alvos('coleta_minima', erro, { empresa_digital: c, empresa_registro: inteira }), ['empresa_registro', 'qualificacao']);
  // only the two minimal stages count in Coleta mínima, whatever else the collection holds
  assert.deepEqual(alvos('coleta_minima', erro, { ...todas(falhou), empresa_digital: c, empresa_registro: c }), ['qualificacao']);
  assert.deepEqual(alvos('coleta_minima', null, { empresa_digital: c, empresa_registro: c }), []); // long state without erro: nothing

  // Coletando with erro: stages falhou / pendente / executando, or Síntese when all six are usable
  assert.deepEqual(alvos('coletando', erro, todas(c)), ['sintese']);
  assert.deepEqual(alvos('coletando', erro, { ...todas(c), setor: inteira }), ['setor', 'sintese']);
  assert.deepEqual(alvos('coletando', erro, { ...todas(c), setor: falhou }), ['setor']);
  assert.deepEqual(alvos('coletando', erro, { ...todas(c), setor: pendente, mercado: exec }), ['setor', 'mercado']);
  assert.deepEqual(alvos('coletando', erro, { ...todas(c), mercado: undefined }), []); // a missing document: no Síntese and no target
  assert.deepEqual(alvos('coletando', null, todas(c)), []);
  assert.deepEqual(alvos('coletando', erro, todas(falhou)), ETAPAS);

  // Pendente runs along: marked rodaJunto; falhou and executando start unchecked
  const op = alvosReexecutar('coletando', erro, { ...todas(c), setor: pendente, mercado: exec, empresa_pessoas: falhou });
  assert.deepEqual(op.map((o) => [o.alvo, o.rodaJunto, o.exclusiva]), [['empresa_pessoas', false, false], ['setor', true, false], ['mercado', false, false]]);
  assert.deepEqual(op.map((o) => o.rotulo), ['Pessoas', 'Setor', 'Mercado']);

  // Coletada and Sintetizando with erro: Síntese only (a coleta stage target would be refused)
  for (const e of ['coletada', 'sintetizando']) {
    assert.deepEqual(alvos(e, erro, todas(falhou)), ['sintese'], e);
    assert.deepEqual(alvos(e, null, todas(c)), [], e);
  }

  // Qualificada: Qualificação only with erro.etapa graduar
  assert.deepEqual(alvos('qualificada', { etapa: 'graduar' }, {}), ['qualificacao']);
  for (const et of ['qualificar', 'coleta_minima', 'email_confirmacao', 'interrupcao:coleta_minima', '']) assert.deepEqual(alvos('qualificada', { etapa: et }, {}), [], et);
  assert.deepEqual(alvos('qualificada', null, {}), []);

  // Analysed states: Síntese and the stages that have a document, with or without erro
  for (const e of ['analise_pronta', 'analise_com_pendencias', 'aprovada']) {
    assert.deepEqual(alvos(e, null, todas(c)), ['sintese', ...ETAPAS], e);
    assert.deepEqual(alvos(e, erro, { setor: c, mercado: falhou }), ['sintese', 'setor', 'mercado'], e);
    assert.deepEqual(alvos(e, null, {}), ['sintese'], e);
  }

  // Everything else: nothing. Arquivada refuses all actions, even with erro.
  for (const e of ['arquivada', 'respondida', 'descartada', 'resposta_breve', 'estado_novo', '']) assert.deepEqual(alvos(e, erro, todas(falhou)), [], e);

  // Rule: every state with erro (except arquivada) has at least one target, given consistent stages
  const casos = [
    ['recebida', {}], ['coleta_minima', { empresa_digital: c, empresa_registro: c }], ['coleta_minima', { empresa_digital: pendente, empresa_registro: pendente }],
    ['coletando', todas(c)], ['coletando', { ...todas(c), setor: pendente }], ['coletada', todas(c)], ['sintetizando', todas(c)],
  ];
  for (const [estado, coleta] of casos) assert.ok(alvosReexecutar(estado, erro, coleta).length > 0, estado);
  assert.ok(alvosReexecutar('qualificada', { etapa: 'graduar' }, {}).length > 0);

  // The function does not mutate its input
  const coleta = todas(c);
  const copia = JSON.stringify(coleta);
  alvosReexecutar('coletando', erro, coleta);
  assert.equal(JSON.stringify(coleta), copia);

  console.log('test-admin-reexecutar: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
