// Spec 02 v0.17 to v0.19 (11/11/2026): fixed subsection labels (rotulo_fora_da_lista, s1 labeled, "CNPJ a
// confirmar." inside Cadastro), porta.combinacao required with combinacao, and regraNome in the reviewer checklist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checklistDoRevisor, nomeDoLimite, nomeDoOrienta } from '../lib/metodoRegras.js';
import { checagens, comCnpjAConfirmar, esquemaRevisor, falhasDeRotulo, instrucaoRevisor, rotulosForaDaLista, validaRevisor } from '../lib/verificacao.js';
import {
  INSTRUCAO_ENQUADRAR, ROTULOS, combinacaoConfere, comCombinacaoNormalizada, enquadramentoGravado, instrucaoMontar, portaParaExibir, simulaEnquadrar, simulaMontar,
} from '../lib/sintese.js';
import { itensDeReparo } from '../lib/reparo.js';

const escopo = readFileSync(new URL('../../metodo/escopo-limites.md', import.meta.url), 'utf8');
const checklist = checklistDoRevisor(escopo);
const corpo = (s, rotulos = ROTULOS[s]) => rotulos.map((r) => `**${r}.** Texto da subseção [inferência].`).join('\n\n');

// --- regraNome (v0.18 and v0.19, 4.2) ------------------------------------------------------------------

test('regraNome: the 21 identifiers and their names, as in the table of spec 02 v0.19, 4.2', () => {
  assert.deepEqual(checklist.map((r) => [r.regra, r.nome]), [
    ['limite-1', 'limite 1 – operação contínua 24 horas ou monitoramento de grandes ambientes de TI'],
    ['limite-2', 'limite 2 – revenda de ferramentas ou serviços de fornecedores'],
    ['limite-3', 'limite 3 – tecnologia sem relação com IA, mesmo com capacidade técnica para executá-la'],
    ['limite-4', 'limite 4 – execução técnica em software de terceiros'],
    ['limite-5', 'limite 5 – treinamento técnico em ferramentas de terceiros, que cabe ao fornecedor'],
    ['limite-6', 'limite 6 – gestão de grandes equipes de engenharia, como métricas de produtividade de times de desenvolvimento'],
    ['orienta-1', 'orienta 1 – contratos com fornecedores de IA'],
    ['orienta-2', 'orienta 2 – grandes plataformas corporativas com IA embarcada (SAP, Salesforce e similares)'],
    ['orienta-3', 'orienta 3 – modernização de sistemas legados com agentes de IA'],
    ['orienta-4', 'orienta 4 – modelos preditivos de aprendizado de máquina sobre grandes bases de dados'],
    ['orienta-5', 'orienta 5 – detecção de incidentes por IA para operações críticas'],
    ['orienta-6', 'orienta 6 – processos formais de compra de soluções de IA'],
    ['assistente-conhecimento', 'assistente de conhecimento interno'],
    ['nao-reformular', 'não reformular o pedido'],
    ['secao-s1', 's1 – Qualificação imediata'],
    ['secao-s2', 's2 – A empresa'],
    ['secao-s3', 's3 – Setor'],
    ['secao-s4', 's4 – Potencial de mercado'],
    ['secao-s5', 's5 – Pessoas'],
    ['secao-s6', 's6 – Enquadramento'],
    ['secao-s7', 's7 – Preparação da primeira conversa'],
  ]);
  // The same identifiers are the enum of regra in the reviewer schema.
  assert.deepEqual(esquemaRevisor(checklist.map((r) => r.regra)).properties.checklist.items.properties.regra.enum, checklist.map((r) => r.regra));
});

test('regraNome: limit up to the first colon or en dash, or the whole sentence; orienta before the colon; only the first letter lowercased', () => {
  assert.equal(nomeDoLimite('Execução técnica em software de terceiros: implantar, configurar ou manter.'), 'execução técnica em software de terceiros');
  assert.equal(nomeDoLimite('Revenda de ferramentas – é o que torna a recomendação independente.'), 'revenda de ferramentas');
  assert.equal(nomeDoLimite('Operação contínua 24 horas.'), 'operação contínua 24 horas');
  assert.equal(nomeDoOrienta('Contratos com fornecedores de IA: aponta cláusulas.'), 'contratos com fornecedores de IA');
  assert.equal(nomeDoOrienta('SAP e IA: texto.'), 'sAP e IA', 'only the first letter changes, as the spec says');
});

test('regraNome: checklist items and the issues derived from them carry it; reading and mechanical issues get null', () => {
  const nomes = Object.fromEntries(checklist.map((r) => [r.regra, r.nome]));
  const r = validaRevisor({
    checklist: [
      { regra: 'secao-s2', resultado: 'violado', secao: null, trecho: 'x', correcaoSugerida: 'y' },
      { regra: 'orienta-1', resultado: 'conforme', secao: null, trecho: null, correcaoSugerida: null },
      { regra: 'desconhecida', resultado: 'conforme', secao: null, trecho: null, correcaoSugerida: null },
    ],
    pendencias: [{ tipo: 'tom', secao: 's3', trecho: 't', correcaoSugerida: 'c' }],
  }, nomes);
  assert.deepEqual(r.checklist.map((x) => x.regraNome), ['s2 – A empresa', 'orienta 1 – contratos com fornecedores de IA', null]);
  assert.deepEqual(r.pendencias.map((x) => [x.tipo, x.regra ?? null, x.regraNome]), [['estrutura', 'secao-s2', 's2 – A empresa'], ['tom', null, null]]);
  const mecanicas = checagens({ secoes: { s3: { corpo: 'curta', vazia: false } }, rascunhoResposta: { assunto: 'a', corpo: 'Olá' }, lang: 'pt-BR', cnpjConfirmado: true }, {});
  assert.ok(mecanicas.length && mecanicas.every((x) => x.regraNome === null));
});

test('reviewer: secao items carry the purpose and the label list of the section (v0.17, 4.2)', () => {
  const i = instrucaoRevisor(checklist);
  assert.match(i, /- secao-s5: o conteúdo de s5 \(Pessoas\) corresponde ao propósito da seção e cada subseção traz o conteúdo do seu rótulo\. Propósito: .* Rótulos, nesta ordem: \*\*Signatário\.\*\* \(ou \*\*Signatária\.\*\*;/);
  for (const s of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) assert.ok(checklist.find((r) => r.regra === `secao-${s}`).texto.includes(`**${ROTULOS[s][0]}`), s);
});

// --- fixed labels (v0.17, 3.3 and 4.1) -----------------------------------------------------------------

test('rotulo_fora_da_lista: the full list in order passes; case, spaces and Signatária do not count', () => {
  for (const s of Object.keys(ROTULOS)) assert.equal(rotulosForaDaLista(s, corpo(s)), null, s);
  assert.equal(rotulosForaDaLista('s5', corpo('s5').replace('**Signatário.**', '**Signatária.**')), null);
  assert.equal(rotulosForaDaLista('s2', corpo('s2').replace('**Presença digital.**', '**presença  Digital.**')), null);
  // Continuation paragraphs carry no label and are not counted.
  assert.equal(rotulosForaDaLista('s7', corpo('s7').replace('\n\n**O que validar.**', '\n\nContinuação.\n\n**O que validar.**')), null);
});

test('rotulo_fora_da_lista: out of the list, repeated, missing and out of order, with the list in the description', () => {
  const [a, b, c] = ROTULOS.s7;
  assert.equal(rotulosForaDaLista('s7', corpo('s7', [a, 'Perguntas', b, c])), `rótulos de s7 – fora da lista: Perguntas. Lista: ${ROTULOS.s7.join(', ')}`);
  assert.match(rotulosForaDaLista('s7', corpo('s7', [a, b, b, c])), /repetidos: O que validar/);
  assert.match(rotulosForaDaLista('s7', corpo('s7', [a, c])), /faltando: O que validar/);
  assert.match(rotulosForaDaLista('s7', corpo('s7', [b, a, c])), /fora da ordem da lista/);
});

test('checagens: rotulo_fora_da_lista per non-empty section, sent to the repair with the label list; empty sections skipped', () => {
  const m = simulaMontar(false);
  const secoes = { ...m, s3: { ...m.s3, corpo: corpo('s3', ROTULOS.s3.slice(1)) }, s5: { corpo: '', vazia: true } };
  const p = checagens({ secoes, rascunhoResposta: { assunto: 'a', corpo: 'Olá' }, lang: 'pt-BR', cnpjConfirmado: true }, {}).filter((x) => x.regra === 'rotulo_fora_da_lista');
  assert.deepEqual(p.map((x) => [x.secao, x.local]), [['s3', 'secoes.s3.corpo']]);
  const [item] = itensDeReparo(p, undefined, 'Ana').get('montar_analise');
  assert.match(item.orientacao, /^use os rótulos da lista da seção, nesta ordem, cada um uma vez e todos eles \(\*\*Setor\.\*\*, \*\*Cadeia de valor e posição da empresa\.\*\*/);
});

test('bloco_sem_rotulo: s1 now needs a label at the opening, as s2 to s7', () => {
  assert.deepEqual(falhasDeRotulo('s1', 'A Capal escreveu pelo formulário.').map((x) => x.caso), ['sem_rotulo']);
  assert.deepEqual(falhasDeRotulo('s1', corpo('s1')), []);
});

test('montar_analise: the instruction carries the summary sentence and the label list of every section', () => {
  const i = instrucaoMontar('A0 (nula)');
  assert.match(i, /A s1 é o resumo: traz em uma linha porte, situação e aderência/);
  assert.match(i, /- \*\*s4:\*\* \*\*Mercado total endereçável \(TAM\)\.\*\* · \*\*Mercado atendível \(SAM\)\.\*\*/);
  assert.match(i, /O rótulo é só o nome da subseção: o valor \("aprovado", "enxuta"\) vai no texto, nunca no rótulo\./);
});

test('cnpj_a_confirmar: "CNPJ a confirmar." goes at the end of the Cadastro subsection, before the next label', () => {
  const s2 = '**Atividade.** Indústria [inferência].\n\n**Cadastro.** Razão social não localizada [inferência].\n\nSem natureza jurídica.\n\n**Porte.** Não encontrado.';
  assert.equal(comCnpjAConfirmar({ corpo: s2, vazia: false }, false),
    '**Atividade.** Indústria [inferência].\n\n**Cadastro.** Razão social não localizada [inferência].\n\nSem natureza jurídica.\n\nCNPJ a confirmar.\n\n**Porte.** Não encontrado.');
  const ultimo = '**Atividade.** Indústria [inferência].\n\n**Cadastro.** Razão social não localizada [inferência].';
  assert.equal(comCnpjAConfirmar({ corpo: ultimo, vazia: false }, false), `${ultimo}\n\nCNPJ a confirmar.`);
});

// --- porta.combinacao (v0.17, 3.1) ---------------------------------------------------------------------

test('porta.combinacao: required and non-empty with combinacao, null otherwise; blank counts as null', () => {
  assert.match(INSTRUCAO_ENQUADRAR, /Com porta provável `combinacao`, diga em `porta\.combinacao` quais portas e em que sequência/);
  const e = simulaEnquadrar();
  const com = (provavel, combinacao) => comCombinacaoNormalizada({ ...e, porta: { ...e.porta, provavel, combinacao } });
  assert.equal(combinacaoConfere(com('conselho', null)), true);
  assert.equal(combinacaoConfere(com('combinacao', '  Projeto seguido de Conselho de IA  ')), true);
  assert.equal(com('combinacao', '  Projeto seguido de Conselho de IA  ').porta.combinacao, 'Projeto seguido de Conselho de IA');
  assert.equal(combinacaoConfere(com('combinacao', '   ')), false);
  assert.equal(combinacaoConfere(com('combinacao', null)), false);
  assert.equal(combinacaoConfere(com('projeto', 'Projeto e Workshop')), false);
});

test('portaCombinacao: stored next to portaProvavel and shown in the e-mail; older versions say "não detalhada"', () => {
  const e = simulaEnquadrar();
  const g = enquadramentoGravado({ ...e, porta: { ...e.porta, provavel: 'combinacao', combinacao: 'Projeto seguido de Conselho de IA' } });
  assert.equal(g.portaCombinacao, 'Projeto seguido de Conselho de IA');
  assert.equal(enquadramentoGravado(e).portaCombinacao, null);
  assert.equal(portaParaExibir(g), 'combinação – Projeto seguido de Conselho de IA');
  assert.equal(portaParaExibir({ portaProvavel: 'combinacao', detalhe: { porta: { combinacao: null } } }), 'combinação (não detalhada)');
  assert.equal(portaParaExibir(enquadramentoGravado(e)), 'conselho');
});
