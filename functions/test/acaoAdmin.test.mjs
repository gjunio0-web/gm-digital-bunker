// Unit tests of acaoAdmin (spec 01 v0.27, section 4.1): the state table with the long-state rule, and the
// mapping of errors to HttpsError (an unexpected error never leaks its message).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triagemPodeSeguir } from '../lib/retomarTriagem.js';
import { deveRetomarColeta } from '../lib/retomarColetaMinima.js';
import { ACOES, ErroAcao, paraHttpsError, validaAlvo, validaEstado, validaStatusColeta } from '../lib/acaoAdmin.js';
import { deveRetomar } from '../lib/retomarTriagem.js';
import { deveSintetizar } from '../lib/sintetizar.js';

const ESTADOS = [
  'recebida', 'coleta_minima', 'qualificada', 'descartada', 'resposta_breve', 'coletando', 'coletada', 'sintetizando',
  'analise_pronta', 'analise_com_pendencias', 'aprovada', 'respondida', 'arquivada',
];
const LONGOS = ['coleta_minima', 'coletando', 'sintetizando'];
const ANALISADA = ['analise_pronta', 'analise_com_pendencias', 'aprovada'];

// Expected from the table of section 4.1, item 2, written independently of the code.
function esperado(acao, estado, { erro, retencao }) {
  if (estado === 'arquivada') return 'acao_invalida_no_estado';
  if (LONGOS.includes(estado) && !erro) return 'ficha_em_processamento';
  const ok = {
    aprovar: ['analise_pronta', 'analise_com_pendencias'].includes(estado),
    editar: ANALISADA.includes(estado),
    reexecutar: ANALISADA.includes(estado) || (erro && [...LONGOS, 'coletada', 'qualificada'].includes(estado)),
    portaDecidida: [...ANALISADA, 'respondida'].includes(estado),
    respostaEnviada: estado === 'aprovada',
    mandarParaAnalise: estado === 'resposta_breve' || (estado === 'qualificada' && retencao),
    arquivar: true,
  }[acao];
  return ok ? null : 'acao_invalida_no_estado';
}

test('validaEstado: every action in every state, with and without erro and retencao, follows the table', () => {
  for (const acao of ACOES) {
    for (const estado of ESTADOS) {
      for (const erro of [false, true]) {
        for (const retencao of [false, true]) {
          const f = { estado, erro: erro ? { etapa: 'x' } : null, retencao: retencao ? { motivo: 'teto_diario' } : null };
          let codigo = null;
          try { validaEstado(acao, f); } catch (e) { assert.ok(e instanceof ErroAcao); codigo = e.codigo; assert.equal(e.extra.estadoAtual, estado); }
          assert.equal(codigo, esperado(acao, estado, { erro, retencao }), `${acao} em ${estado} (erro ${erro}, retencao ${retencao})`);
        }
      }
    }
  }
});

test('paraHttpsError: each code maps to its HttpsError with details {codigo, estadoAtual, campo}', () => {
  const casos = {
    nao_autenticado: 'unauthenticated', sem_permissao: 'permission-denied', ficha_inexistente: 'not-found',
    acao_invalida_no_estado: 'failed-precondition', parametro_invalido: 'invalid-argument',
    ficha_em_processamento: 'failed-precondition', conflito: 'aborted', interno: 'internal',
  };
  for (const [codigo, https] of Object.entries(casos)) {
    const e = paraHttpsError(new ErroAcao(codigo, { estadoAtual: 'aprovada', campo: 'acao' }));
    assert.equal(e.code, https);
    assert.deepEqual(e.details, { codigo, estadoAtual: 'aprovada', campo: 'acao' });
    assert.ok(e.message.length > 0 && e.message.length < 80);
  }
});

test('paraHttpsError: an unexpected error becomes interno without its own message', () => {
  const e = paraHttpsError(new Error('segredo: /fichas/abc caiu em joao@exemplo.com'));
  assert.equal(e.code, 'internal');
  assert.deepEqual(e.details, { codigo: 'interno' });
  assert.ok(!/segredo|joao|fichas/.test(e.message));
});

test('modeloDaEdicao: the model of vN followed by " · edição humana", with a single suffix on an edit of an edit', async () => {
  const { modeloDaEdicao } = await import('../lib/acaoAdmin.js');
  const s0 = (m) => ({ s0: { corpo: `**Método:** versão m1 · **Modelo:** ${m}` } });
  assert.equal(modeloDaEdicao({ secoes: s0('claude-sonnet-5-5') }), 'claude-sonnet-5-5 · edição humana');
  assert.equal(modeloDaEdicao({ secoes: s0('claude-sonnet-5-5 · edição humana') }), 'claude-sonnet-5-5 · edição humana');
  assert.equal(modeloDaEdicao({ autor: { tipo: 'ia', id: 'claude-haiku-5-5' }, secoes: {} }), 'claude-haiku-5-5 · edição humana');
  assert.equal(modeloDaEdicao({ autor: { tipo: 'humano', id: 'uid1' } }), 'não informado · edição humana');
});

// --- reexecutar: alvo and the trigger condition of retomarTriagem (phase 5b, second part) -------------------

const campoDe = (fn) => { try { fn(); } catch (e) { return `${e.codigo}:${e.extra?.campo}`; } return 'ok'; };

test('validaAlvo: shape (non-empty list, no repetition, known values) and sintese / qualificacao only alone', () => {
  const f = { estado: 'analise_pronta', erro: null };
  for (const ruim of [undefined, null, 'sintese', [], ['x'], [1], ['sintese', 'sintese'], ['setor', 'setor'], ['sintese', 'setor'], ['qualificacao', 'sintese'], ['qualificacao', 'mercado']]) {
    assert.equal(campoDe(() => validaAlvo(ruim, f)), 'parametro_invalido:alvo', JSON.stringify(ruim));
  }
  assert.deepEqual(validaAlvo(['sintese'], f), { tipo: 'sintese', alvos: ['sintese'] });
  assert.deepEqual(validaAlvo(['setor', 'mercado'], f), { tipo: 'coleta', alvos: ['setor', 'mercado'] });
});

test('validaAlvo: sintese only in the analysed states and in sintetizando with erro; qualificacao only with erro.etapa qualificar / graduar', () => {
  const erro = (etapa) => ({ etapa });
  for (const estado of ['analise_pronta', 'analise_com_pendencias', 'aprovada']) assert.equal(validaAlvo(['sintese'], { estado, erro: null }).tipo, 'sintese');
  assert.equal(validaAlvo(['sintese'], { estado: 'sintetizando', erro: erro('sintetizar') }).tipo, 'sintese');
  assert.equal(validaAlvo(['sintese'], { estado: 'coletada', erro: erro('interrupcao:coletada') }).tipo, 'sintese');
  assert.equal(validaAlvo(['sintese'], { estado: 'coletada', erro: erro('sintetizar') }).tipo, 'sintese');
  for (const f of [{ estado: 'sintetizando', erro: null }, { estado: 'coletada', erro: null }, { estado: 'coletando', erro: erro('coletar') }, { estado: 'coleta_minima', erro: erro('qualificar') }, { estado: 'qualificada', erro: erro('graduar') }]) {
    assert.equal(campoDe(() => validaAlvo(['sintese'], f)), 'parametro_invalido:alvo', JSON.stringify(f));
  }
  assert.equal(validaAlvo(['qualificacao'], { estado: 'coleta_minima', erro: erro('qualificar') }).tipo, 'qualificacao');
  assert.equal(validaAlvo(['qualificacao'], { estado: 'qualificada', erro: erro('graduar') }).tipo, 'qualificacao');
  for (const f of [
    { estado: 'coleta_minima', erro: erro('coleta_minima') }, { estado: 'coleta_minima', erro: erro('graduar') }, { estado: 'qualificada', erro: erro('qualificar') },
    { estado: 'coleta_minima', erro: erro('interrupcao:coleta_minima') }, { estado: 'analise_pronta', erro: null }, { estado: 'qualificada', erro: null },
  ]) assert.equal(campoDe(() => validaAlvo(['qualificacao'], f)), 'parametro_invalido:alvo', JSON.stringify(f));
});

test('deveRetomar: only when erro goes from filled to null, in coleta_minima or in qualificada without lead', () => {
  const erro = { etapa: 'x' };
  assert.equal(deveRetomar({ erro }, { estado: 'coleta_minima', erro: null }), 'qualificar');
  assert.equal(deveRetomar({ erro }, { estado: 'qualificada', erro: null }), 'graduar');
  assert.equal(deveRetomar({ erro }, { estado: 'qualificada', erro: null, lead: { grau: 'A' } }), null);
  assert.equal(deveRetomar({ erro }, { estado: 'coletando', erro: null }), null);
  assert.equal(deveRetomar({ erro }, { estado: 'coleta_minima', erro }), null);
  assert.equal(deveRetomar({ erro: null }, { estado: 'coleta_minima', erro: null }), null);
  assert.equal(deveRetomar(undefined, { estado: 'coleta_minima', erro: null }), null);
  assert.equal(deveRetomar({ erro }, undefined), null);
});

test('deveSintetizar: the ficha moves to coletada, or erro goes from filled to null while it stays in coletada', () => {
  const erro = { etapa: 'interrupcao:coletada' };
  assert.equal(deveSintetizar({ estado: 'coletando' }, { estado: 'coletada' }), true);
  assert.equal(deveSintetizar(undefined, { estado: 'coletada' }), true);
  assert.equal(deveSintetizar({ estado: 'coletada', erro }, { estado: 'coletada', erro: null }), true);
  assert.equal(deveSintetizar({ estado: 'coletada', erro }, { estado: 'coletada', erro }), false);
  assert.equal(deveSintetizar({ estado: 'coletada', erro: null }, { estado: 'coletada', erro }), false);
  assert.equal(deveSintetizar({ estado: 'coletada', erro: null }, { estado: 'coletada', erro: null }), false);
  assert.equal(deveSintetizar({ estado: 'coletada', erro }, { estado: 'sintetizando', erro: null }), false);
  assert.equal(deveSintetizar({ estado: 'coletando' }, { estado: 'analise_pronta' }), false);
});

test('validaAlvo (coleta): analysed states take any of the six; erro in coleta_minima only the two minimal stages; coletando with erro any; coletada and sintetizando with erro none', () => {
  const erro = (etapa) => ({ etapa });
  for (const estado of ['analise_pronta', 'analise_com_pendencias', 'aprovada']) assert.equal(validaAlvo(['empresa_pessoas', 'mercado'], { estado, erro: null }).tipo, 'coleta');
  assert.equal(validaAlvo(['empresa_digital', 'empresa_registro'], { estado: 'coleta_minima', erro: erro('coleta_minima') }).tipo, 'coleta');
  assert.equal(validaAlvo(['empresa_registro'], { estado: 'coleta_minima', erro: erro('interrupcao:coleta_minima') }).tipo, 'coleta');
  assert.equal(validaAlvo(['setor', 'empresa_digital'], { estado: 'coletando', erro: erro('coletar') }).tipo, 'coleta');
  for (const f of [
    { estado: 'coleta_minima', erro: erro('coleta_minima') }, // only with a non-minimal stage, below
  ]) assert.equal(campoDe(() => validaAlvo(['setor'], f)), 'parametro_invalido:alvo');
  for (const f of [
    { estado: 'sintetizando', erro: erro('sintetizar') },
    { estado: 'coletada', erro: erro('sintetizar') },
    { estado: 'coletada', erro: erro('interrupcao:coletada') },
    { estado: 'qualificada', erro: erro('graduar') },
    { estado: 'resposta_breve', erro: null },
    { estado: 'respondida', erro: null },
  ]) assert.equal(campoDe(() => validaAlvo(['empresa_digital'], f)), 'parametro_invalido:alvo', JSON.stringify(f));
});

test('validaStatusColeta: analysed states need the stage to exist; with erro only falhou, pendente and executando are offered', () => {
  const analisada = { estado: 'analise_pronta' };
  assert.doesNotThrow(() => validaStatusColeta(['setor', 'mercado'], analisada, { setor: 'concluida', mercado: 'falhou' }));
  assert.equal(campoDe(() => validaStatusColeta(['setor'], analisada, { setor: undefined })), 'parametro_invalido:alvo');
  const comErro = { estado: 'coletando' };
  for (const st of ['falhou', 'pendente', 'executando']) assert.doesNotThrow(() => validaStatusColeta(['setor'], comErro, { setor: st }));
  assert.equal(campoDe(() => validaStatusColeta(['setor'], comErro, { setor: 'concluida' })), 'parametro_invalido:alvo');
  assert.equal(campoDe(() => validaStatusColeta(['setor', 'mercado'], comErro, { setor: 'falhou', mercado: 'concluida' })), 'parametro_invalido:alvo');
  assert.equal(campoDe(() => validaStatusColeta(['setor'], comErro, { setor: undefined })), 'parametro_invalido:alvo');
});

test('deveRetomarColeta: erro filled to null in coleta_minima only', () => {
  const erro = { etapa: 'coleta_minima' };
  assert.equal(deveRetomarColeta({ estado: 'coleta_minima', erro }, { estado: 'coleta_minima', erro: null }), true);
  assert.equal(deveRetomarColeta({ estado: 'coleta_minima', erro: null }, { estado: 'coleta_minima', erro: null }), false);
  assert.equal(deveRetomarColeta({ estado: 'coleta_minima', erro }, { estado: 'coleta_minima', erro }), false);
  assert.equal(deveRetomarColeta({ estado: 'coletando', erro }, { estado: 'coletando', erro: null }), false);
  assert.equal(deveRetomarColeta({ estado: 'qualificada', erro }, { estado: 'qualificada', erro: null }), false);
  assert.equal(deveRetomarColeta(undefined, { estado: 'coleta_minima', erro: null }), false);
  assert.equal(deveRetomarColeta({ estado: 'coleta_minima', erro }, undefined), false);
});

test('triagemPodeSeguir: concluida, nao_aplicavel or preserved whole; pendente, executando or falhou alone make it give up', () => {
  const c = { status: 'concluida' };
  assert.equal(triagemPodeSeguir([c, c]), true);
  assert.equal(triagemPodeSeguir([c, { status: 'nao_aplicavel' }]), true);
  assert.equal(triagemPodeSeguir([c, { status: 'falhou', preservado: { blocos: ['etapa'] } }]), true);
  assert.equal(triagemPodeSeguir([c, { status: 'falhou', preservado: { blocos: ['apollo'] } }]), false);
  for (const status of ['pendente', 'executando', 'falhou']) assert.equal(triagemPodeSeguir([c, { status }]), false, status);
  assert.equal(triagemPodeSeguir([c, {}]), false);
});
