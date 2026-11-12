// Spec 02 v0.20 (12/11/2026): adjustments from round R1g – two exceptions in numero_sem_fonte, the reviewer told
// not to list correct excerpts, and the method files of the reviewer and of the correction. The sentences come
// from the R1g versions (GAT Logística v31, Capal v23, Elite 90 Pro v29) and from the reteste (Elite v27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METODO_CORRECAO, METODO_REVISOR, instrucaoRevisor, numerosSemFonte } from '../lib/verificacao.js';
import { medidasDaRodada } from '../scripts/relatorio-b2.mjs';

test('numero_sem_fonte: item numbering "(n)" is not a number (spec 02 v0.20, 4.1)', () => {
  for (const t of [
    // At the start of the paragraph (GAT Logística v31, s3).
    '(1) Roteirização de entregas fracionadas: otimização [prática, 30/10/2026], com volume alto e variabilidade média.',
    '(6) Análise comparativa de propostas: aumentação [prática], saída única com julgamento humano.',
    // Right after a bold label (Capal v23, s6).
    '**Hipóteses de alavanca.** (1) Atendimento ao cooperado, rotina de respostas recorrentes: lente otimização.',
    // After a colon and after a semicolon.
    'Itens avaliados: (1) atendimento aos cooperados; (2) planejamento da produção.',
    // Up to two digits.
    '(12) Conferência de documentos fiscais: automação se a validação for por amostra.',
  ]) assert.deepEqual(numerosSemFonte(t), [], t);
});

test('numero_sem_fonte: a number in parentheses mid-sentence, or with three digits, is still a number', () => {
  assert.equal(numerosSemFonte('A receita cresceu (12) vezes no ano.').length, 1);
  assert.equal(numerosSemFonte('(123) Item com três dígitos.').length, 1);
  assert.equal(numerosSemFonte('(1)Item sem espaço depois do parêntese.').length, 1);
});

test('numero_sem_fonte: "[inferência, …]" counts as "[inferência]" (spec 02 v0.20, 4.1)', () => {
  assert.deepEqual(numerosSemFonte('O Hunter não retornou registro (HTTP 404) [inferência, sem fonte indexada].'), []);
  assert.deepEqual(numerosSemFonte('A GAT aparece como operador integrado, com matriz de 76 mil m² e seis unidades [inferência, a partir de dados do site, ver s2].'), []);
  // Other bracketed labels are not inference labels (Elite 90 Pro v29, s4: a real failure, kept).
  assert.equal(numerosSemFonte('**Mercado total endereçável (TAM).** R$ 8 a 17 bilhões por ano no mercado fitness nacional, ano-base 2024, confiança baixa.').length, 1);
  assert.equal(numerosSemFonte('Matriz de 76 mil m² [hipótese, a validar].').length, 1);
});

test('reviewer: Part 2 tells it not to list correct excerpts (spec 02 v0.20, 4.2)', () => {
  assert.match(instrucaoRevisor([]), /a correção sugerida\. Aponte só o que precisa ser mudado: se o trecho está correto, não o inclua, nem com a observação de que está correto\. Não aponte o que as checagens/);
});

test('method files: reviewer with escopo-limites.md 1, 3 to 7 and portas-materiais.md; correction with portas-materiais.md', () => {
  assert.deepEqual(METODO_REVISOR, { 'glossario.md': 'tudo', 'escopo-limites.md': [1, 3, 4, 5, 6, 7], 'portas-materiais.md': 'tudo' });
  assert.deepEqual(METODO_CORRECAO, { 'glossario.md': 'tudo', 'escopo-limites.md': 'tudo', 'portas-materiais.md': 'tudo' });
});

test('B2 report: reviewer and correction cost and issues kept in the enquadramento per analysis', () => {
  const base = {
    id: 'v31',
    enquadramento: { detalhe: {} },
    verificacao: { pendencias: [], reparos: [], checklist: [] },
    uso: { revisor: { usdEstimado: 0.07 }, montar_analise: { usdEstimado: 0.2 } },
  };
  const correcao = {
    id: 'v32',
    verificacao: { status: 'com_pendencias' },
    uso: { corrigir: { usdEstimado: 0.11 } },
    correcao: {
      pendencias: [{ secao: 'enquadramento' }, { secao: 's6' }, { secao: 'enquadramento' }],
      tratamentos: [{ indice: 0, tratamento: 'mantida' }, { indice: 1, tratamento: 'corrigida' }, { indice: 2, tratamento: 'mantida' }],
    },
  };
  const m = medidasDaRodada(base, correcao, null);
  assert.equal(m.mantidasEnquadramento, 2);
  assert.equal(m.usdRevisor, 0.07);
  assert.equal(m.usdCorrigir, 0.11);
  assert.equal(medidasDaRodada(base, null, null).mantidasEnquadramento, 0);
});
