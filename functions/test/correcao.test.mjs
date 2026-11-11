// Phase 4 – reviewer by checklist and correction (spec 02 v0.12, 4.2 and 4.3): checklist generated from the
// method, conversion of violations, the correction answer and the version it becomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checklistDoRevisor } from '../lib/metodoRegras.js';
import { ESQUEMA_REVISOR, instrucaoRevisor, mensagemRevisor, simulaRevisor, validaRevisor } from '../lib/verificacao.js';
import {
  ESQUEMA_CORRIGIR, RAZAO_ENQUADRAMENTO, analiseParaCorrecao, comMantidasDoEnquadramento, comTratamento, ehDoEnquadramento, mantidaPeloCodigo, mensagemCorrigir, prontaAposCorrecao, simulaCorrecao, vaiACorrecao, validaCorrecao, versaoCorrigida,
} from '../lib/correcao.js';
import { coletaDe, enquadramentoGravado, normalizaEnquadramento, simulaConversa, simulaEnquadrar, simulaMontar, validaEnquadrar } from '../lib/sintese.js';

const escopo = readFileSync(new URL('../../metodo/escopo-limites.md', import.meta.url), 'utf8');
const checklist = checklistDoRevisor(escopo);

test('checklist: six limits, six items of section 4 in order, knowledge assistant and no reshaping', () => {
  assert.deepEqual(checklist.map((r) => r.regra), [
    'limite-1', 'limite-2', 'limite-3', 'limite-4', 'limite-5', 'limite-6',
    'orienta-1', 'orienta-2', 'orienta-3', 'orienta-4', 'orienta-5', 'orienta-6', 'assistente-conhecimento', 'nao-reformular',
    'secao-s1', 'secao-s2', 'secao-s3', 'secao-s4', 'secao-s5', 'secao-s6', 'secao-s7',
  ]);
  assert.match(checklist[16].texto, /^o conteúdo de s3 \(Setor\) corresponde ao propósito da seção e cada subseção traz o conteúdo do seu rótulo\. Propósito: cadeia de valor[\s\S]* Rótulos, nesta ordem: \*\*Setor\.\*\*/);
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
  }, Object.fromEntries(checklist.map((x) => [x.regra, x.nome])));
  assert.equal(r.checklist.length, 2);
  assert.deepEqual(r.pendencias[0], { tipo: 'escopo', regra: 'limite-4', regraNome: 'limite 4 – execução técnica em software de terceiros', secao: 's6', trecho: 'implantar o CRM', correcaoSugerida: 'orientar a escolha' });
  assert.equal(r.pendencias[1].regraNome, null, 'reading issues have no checklist rule');
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

test('correction: schema of the analysis plus treatments, without enquadramento; message with numbered issues', () => {
  for (const k of ['s1', 's7', 'resumoExecutivo', 'conversa', 'rascunhoResposta', 'tratamentos']) assert.ok(ESQUEMA_CORRIGIR.required.includes(k), k);
  assert.ok(!('enquadramento' in ESQUEMA_CORRIGIR.properties), 'spec 02 v0.16, 4.3');
  const t = textos();
  const pend = [{ tipo: 'lastro', secao: 's1', trecho: 'Leitura simulada', correcaoSugerida: 'marcar' }];
  const entrada = analiseParaCorrecao(t);
  assert.ok(!('enquadramento' in entrada.analise));
  const msg = mensagemCorrigir(entrada, '<fontes-disponiveis>\n</fontes-disponiveis>', pend)[0].texto;
  assert.match(msg, /<enquadramento>[\s\S]*<\/enquadramento>\n<analise>/);
  assert.match(msg, /O enquadramento é só contexto: não o devolva\./);
  assert.match(msg, /<pendencias>[\s\S]*"indice": 0[\s\S]*<\/pendencias>/);
  assert.match(msg, /Corrija a análise nos trechos apontados em <pendencias>/);
});

test('correction: texts taken, enquadramento copied from vN; missing treatment counts as kept', () => {
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
  // An enquadramento returned anyway is ignored: vN+1 copies the one of vN (spec 02 v0.16, 4.3).
  const outra = { ...structuredClone(saida), enquadramento: { porta: { provavel: 'projeto' } } };
  const v2 = versaoCorrigida(t, validaCorrecao(outra, 2), coletaDe({}));
  assert.deepEqual(v2.campos.enquadramento, t.enquadramento);
});

test('correction: issues in the enquadramento are kept by the code, after the corrected ones', () => {
  const pend = [
    { tipo: 'lastro', secao: 's1', trecho: 'a', correcaoSugerida: 'b' },
    { tipo: 'lastro_interno', secao: 'enquadramento', trecho: 'c', correcaoSugerida: 'd' },
    { tipo: 'escopo', regra: 'limite-4', secao: 'enquadramento', trecho: 'e', correcaoSugerida: 'f' },
  ];
  assert.deepEqual(pend.map(ehDoEnquadramento), [false, true, true]);
  assert.deepEqual(mantidaPeloCodigo(pend[1]), { ...pend[1], tratamento: 'mantida', razao: RAZAO_ENQUADRAMENTO });
  assert.equal(RAZAO_ENQUADRAMENTO, 'bloco estruturado não editável pela correção');
  const c = comMantidasDoEnquadramento({ tratamentos: [{ indice: 0, tratamento: 'corrigida', novoTrecho: 'x', razao: null }] }, 2);
  const todas = comTratamento([pend[0], pend[1], pend[2]], c.tratamentos);
  assert.deepEqual(todas.map((x) => [x.secao, x.tratamento]), [['s1', 'corrigida'], ['enquadramento', 'mantida'], ['enquadramento', 'mantida']]);
  assert.equal(todas[2].razao, RAZAO_ENQUADRAMENTO);
  assert.equal(prontaAposCorrecao([], todas), false);
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

test('structure: montar instruction lists the seven sections with their purposes; titles are schema constants', async () => {
  const { instrucaoMontar, ESQUEMA_MONTAR, PROPOSITOS } = await import('../lib/sintese.js');
  const i = instrucaoMontar('A0 (fora)');
  assert.match(i, /^Monte a análise preliminar em sete seções \(s1 a s7\); s0 e s8 são montadas pelo código/);
  assert.ok(i.includes(`- **s4 Potencial de mercado** – ${PROPOSITOS.s4}`));
  assert.ok(!i.includes('oito seções'));
  assert.equal(ESQUEMA_MONTAR.properties.s5.properties.titulo.const, 'Pessoas');
});

test('structure: reviewer rule is an enum of the generated ids; secao-* violations become structure issues', async () => {
  const { esquemaRevisor } = await import('../lib/verificacao.js');
  const ids = checklist.map((r) => r.regra);
  assert.deepEqual(esquemaRevisor(ids).properties.checklist.items.properties.regra.enum, ids);
  const r = validaRevisor({
    checklist: [
      { regra: 'secao-s3', resultado: 'violado', secao: null, trecho: 'Signatário…', correcaoSugerida: 'Levar à s5.' },
      { regra: 'limite-4: Execução técnica', resultado: 'violado', secao: 's6', trecho: 'x', correcaoSugerida: 'y' },
    ],
    pendencias: [],
  });
  assert.deepEqual(r.pendencias.map((p) => [p.tipo, p.regra, p.secao]), [['estrutura', 'secao-s3', 's3'], ['escopo', 'limite-4', 's6']]);
});
