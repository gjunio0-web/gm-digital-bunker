// Phase 4 – reviewer by checklist and correction (spec 02 v0.12, 4.2 and 4.3): checklist generated from the
// method, conversion of violations, the correction answer and the version it becomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checklistDoRevisor } from '../lib/metodoRegras.js';
import { ESQUEMA_REVISOR, instrucaoRevisor, mensagemRevisor, simulaRevisor, validaRevisor } from '../lib/verificacao.js';
import {
  ESQUEMA_CORRIGIR, analiseParaCorrecao, comTratamento, mensagemCorrigir, prontaAposCorrecao, simulaCorrecao, vaiACorrecao, validaCorrecao, versaoCorrigida,
} from '../lib/correcao.js';
import { coletaDe, enquadramentoGravado, normalizaEnquadramento, simulaConversa, simulaEnquadrar, simulaMontar, validaEnquadrar } from '../lib/sintese.js';

const escopo = readFileSync(new URL('../../metodo/escopo-limites.md', import.meta.url), 'utf8');
const checklist = checklistDoRevisor(escopo);

test('checklist: six limits, six items of section 4 in order, knowledge assistant and no reshaping', () => {
  assert.deepEqual(checklist.map((r) => r.regra), [
    'limite-1', 'limite-2', 'limite-3', 'limite-4', 'limite-5', 'limite-6',
    'orienta-1', 'orienta-2', 'orienta-3', 'orienta-4', 'orienta-5', 'orienta-6', 'assistente-conhecimento', 'nao-reformular',
  ]);
  assert.match(checklist[3].texto, /^Execução técnica em software de terceiros/);
  assert.match(checklist[6].texto, /^Contratos com fornecedores de IA/);
  assert.match(checklist[12].texto, /^Não induzir clientes a desenvolver assistente de conhecimento interno próprio/);
  assert.match(checklist[13].texto, /^Nunca reformular um pedido fora do escopo/);
  const i = instrucaoRevisor(checklist);
  assert.match(i, /- limite-4: Execução técnica em software de terceiros/);
  assert.match(i, /\(g\) afirmações sobre a própria prática ou seus casos que não constem de escopo-limites\.md e portas-materiais\.md \(lastro interno\)/);
});

test('reviewer: reads sections, enquadramento, conversa and draft; violations become scope issues; checklist kept', () => {
  const m = mensagemRevisor({ secoes: simulaMontar(false), enquadramento: simulaEnquadrar(), conversa: { perguntas: [] }, rascunhoResposta: { assunto: 'a', corpo: 'b' } }, checklist);
  for (const t of ['<secao id="s7">', '<enquadramento>', '<conversa>', '<rascunho>']) assert.ok(m.includes(t), t);
  assert.deepEqual(ESQUEMA_REVISOR.properties.pendencias.items.properties.tipo.enum, ['lastro', 'hipotese', 'promessa', 'vocabulario', 'tom', 'lastro_interno']);
  const r = validaRevisor({
    checklist: [
      { regra: 'limite-4', resultado: 'violado', secao: 's6', trecho: 'implantar o CRM', correcaoSugerida: 'orientar a escolha' },
      { regra: 'limite-1', resultado: 'conforme', secao: null, trecho: null, correcaoSugerida: null },
    ],
    pendencias: [{ tipo: 'lastro_interno', secao: 'rascunho', trecho: 'reduziu o tempo em 40%', correcaoSugerida: 'retirar' }],
  });
  assert.equal(r.checklist.length, 2);
  assert.deepEqual(r.pendencias[0], { tipo: 'escopo', regra: 'limite-4', secao: 's6', trecho: 'implantar o CRM', correcaoSugerida: 'orientar a escolha' });
  assert.equal(r.pendencias[1].tipo, 'lastro_interno');
  assert.throws(() => validaRevisor({ checklist: [{ regra: 'x', resultado: 'talvez' }], pendencias: [] }), /revisor/);
  assert.ok(r.pendencias.every(vaiACorrecao));
  assert.ok(!vaiACorrecao({ tipo: 'mecanica' }));
});

const textos = () => {
  const m = simulaMontar(false);
  const c = simulaConversa('Ana Teste');
  const e = normalizaEnquadramento(validaEnquadrar(simulaEnquadrar()));
  return {
    secoes: { ...m, s0: { titulo: 'Cabeçalho', corpo: 'x', vazia: false, motivoVazia: null }, s8: { titulo: 'Fontes', corpo: '', vazia: true, motivoVazia: 'y' } },
    resumoExecutivo: m.resumoExecutivo, rascunhoResposta: c.rascunhoResposta,
    conversa: { perguntas: c.perguntas, materiais: c.materiais, pontosDeAtencao: c.pontosDeAtencaoParaOConsultor },
    enquadramento: enquadramentoGravado(e),
  };
};

test('correction: schema of the analysis plus treatments; message with numbered issues', () => {
  for (const k of ['s1', 's7', 'resumoExecutivo', 'enquadramento', 'conversa', 'rascunhoResposta', 'tratamentos']) assert.ok(ESQUEMA_CORRIGIR.required.includes(k), k);
  const t = textos();
  const pend = [{ tipo: 'lastro', secao: 's1', trecho: 'Leitura simulada', correcaoSugerida: 'marcar' }];
  const msg = mensagemCorrigir(analiseParaCorrecao(t), '<fontes-disponiveis>\n</fontes-disponiveis>', pend)[0].texto;
  assert.match(msg, /<pendencias>[\s\S]*"indice": 0[\s\S]*<\/pendencias>/);
  assert.match(msg, /Corrija a análise nos trechos apontados em <pendencias>/);
});

test('correction: texts taken, choices of the enquadramento kept; missing treatment counts as kept', () => {
  const t = textos();
  const pend = [{ tipo: 'lastro', secao: 's1', trecho: 'Leitura simulada no emulador', correcaoSugerida: 'marcar' }, { tipo: 'tom', secao: 's2', trecho: 'x', correcaoSugerida: 'y' }];
  const saida = simulaCorrecao(analiseParaCorrecao(t), pend);
  saida.tratamentos = saida.tratamentos.slice(0, 1);
  const c = validaCorrecao(saida, 2);
  assert.deepEqual(c.tratamentos.map((x) => x.tratamento), ['corrigida', 'mantida']);
  assert.equal(c.tratamentos[1].razao, 'sem tratamento informado na correção');
  const v = versaoCorrigida(t, c, coletaDe({}));
  assert.match(v.campos.secoes.s1.corpo, /Leitura simulada no emulador \[inferência\]/);
  assert.equal(v.campos.secoes.s8.titulo, 'Fontes');
  assert.deepEqual(v.avisos, []);
  // A correction that changes a choice keeps the enquadramento of the base, with a warning.
  const outra = structuredClone(saida);
  outra.enquadramento.porta.provavel = 'projeto';
  const v2 = versaoCorrigida(t, validaCorrecao(outra, 2), coletaDe({}));
  assert.equal(v2.campos.enquadramento.portaProvavel, 'conselho');
  assert.match(v2.avisos[0], /^correcao_enquadramento:/);
});

test('final state after a correction: ready only with every issue corrected and no mechanical issue', () => {
  const pend = [{ tipo: 'lastro', secao: 's1', trecho: 'a', correcaoSugerida: 'b' }, { tipo: 'tom', secao: 's2', trecho: 'c', correcaoSugerida: 'd' }];
  const todas = comTratamento(pend, [{ indice: 0, tratamento: 'corrigida', novoTrecho: 'x', razao: null }, { indice: 1, tratamento: 'corrigida', novoTrecho: 'y', razao: null }]);
  assert.equal(todas[0].tratamento, 'corrigida');
  assert.equal(prontaAposCorrecao([], todas), true);
  assert.equal(prontaAposCorrecao([{ tipo: 'mecanica' }], todas), false);
  assert.equal(prontaAposCorrecao([], comTratamento(pend, [{ indice: 0, tratamento: 'corrigida' }])), false);
  assert.equal(simulaRevisor(checklist, 'texto', true).pendencias.length, 1);
});
