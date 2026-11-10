// Spec 02 v0.16 (10/11/2026): defect fixes found in phase B2 and the conditions of the design C retest. The
// texts come from the B2 versions (round R1f): GAT Logística v17 and v18, Elite 90 Pro v14, Startup Teste B2 v12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CNPJ_AVISADO, checagens, comCnpjAConfirmar, falhasDeRotulo, siglasSemExtenso } from '../lib/verificacao.js';
import { INSTRUCAO_FONTES, mensagemConversa, mensagemEnquadrar, mensagemMontar } from '../lib/sintese.js';
import { comParametros, esforcoDe, modeloDe } from '../lib/modelos.js';

// GAT Logística v18, s4 (design C, R1f): the long form in the same sentence as the label's acronym.
const gatV18s4 = [
  '**TAM.** Mercado total endereçável (TAM): R$ 247 bilhões de receita dos operadores logísticos no Brasil em 2025, segundo o estudo da ABOL com o ILOS [F:mercado:0].',
  '**SAM.** Mercado endereçável disponível (SAM): não estimado. As fontes não trazem receita por estado nem por segmento (não encontrado).',
  '**SOM.** Mercado obtível (SOM): não estimado. Faltam dados de adoção de IA em roteirização e armazenagem.',
].join('\n\n');

test('sigla: the long form counts in the same sentence, before or after the acronym (spec 02 v0.16, 4.1)', () => {
  assert.deepEqual(siglasSemExtenso('**TAM.** Mercado total endereçável (TAM)'), []);
  assert.deepEqual(siglasSemExtenso(gatV18s4).filter((s) => ['TAM', 'SAM', 'SOM'].includes(s)), []);
  assert.deepEqual(siglasSemExtenso('O mercado total endereçável (TAM) é amplo, e o TAM cresce.'), []);
  assert.deepEqual(siglasSemExtenso('O TAM cresce; é o mercado total endereçável (TAM) do setor.'), []);
  // Another sentence does not count: GAT Logística v17, s4, and a long form one sentence later.
  assert.deepEqual(siglasSemExtenso('**TAM.** R$ 247 bilhões de receita dos operadores logísticos no Brasil em 2025.'), ['TAM']);
  assert.deepEqual(siglasSemExtenso('O TAM é amplo. Mercado total endereçável (TAM) é a soma.'), ['TAM']);
  assert.deepEqual(siglasSemExtenso('O TAM é amplo.\n\nMercado total endereçável (TAM) é a soma.'), ['TAM']);
  // Earlier rules hold: inside or right before a parenthesis.
  assert.deepEqual(siglasSemExtenso('Cadastro Nacional da Pessoa Jurídica (CNPJ) confirmado. O CNPJ é válido. A LGPD incide.'), ['LGPD']);
});

test('sigla in checagens: GAT v18 s4 leaves no acronym issue for TAM, SAM or SOM', () => {
  const p = checagens({ secoes: { s4: { corpo: gatV18s4, vazia: false } }, rascunhoResposta: { assunto: 'a', corpo: 'Olá' }, lang: 'pt-BR', cnpjConfirmado: true }, {});
  assert.deepEqual(p.filter((x) => x.regra === 'sigla' && /\b(TAM|SAM|SOM)\b/.test(x.trecho)), []);
});

test('cnpj_a_confirmar: "não confirmado" counts; otherwise the code appends "CNPJ a confirmar." to s2', () => {
  // Elite 90 Pro v14, s2: "não confirmados" already says it – nothing to add, no issue.
  const elite = '**Cadastro.** CNPJ, razão social e porte legal não confirmados; o site não exibe CNPJ [F:empresa_registro:4].';
  assert.ok(CNPJ_AVISADO.test(elite));
  assert.equal(comCnpjAConfirmar({ corpo: elite, vazia: false }, false), null);
  assert.equal(checagens({ secoes: { s2: { corpo: elite, vazia: false } }, rascunhoResposta: { assunto: 'a', corpo: 'Olá' }, lang: 'pt-BR', cnpjConfirmado: false }, {}).filter((x) => x.regra === 'cnpj_a_confirmar').length, 0);
  // Startup Teste B2 v12, s2: no word on the CNPJ – the code appends the paragraph.
  const startup = '**Atividade.** Startup em fase inicial, sem site próprio localizado [inferência].\n\nNão foram encontradas vagas abertas.';
  const novo = comCnpjAConfirmar({ corpo: startup, vazia: false }, false);
  assert.equal(novo, `${startup}\n\nCNPJ a confirmar.`);
  assert.deepEqual(falhasDeRotulo('s2', novo), [], 'a continuation paragraph needs no label');
  assert.equal(checagens({ secoes: { s2: { corpo: novo, vazia: false } }, rascunhoResposta: { assunto: 'a', corpo: 'Olá' }, lang: 'pt-BR', cnpjConfirmado: false }, {}).filter((x) => x.regra === 'cnpj_a_confirmar').length, 0);
  // Confirmed CNPJ, empty s2, or "a confirmar" already there: nothing changes.
  assert.equal(comCnpjAConfirmar({ corpo: startup, vazia: false }, true), null);
  assert.equal(comCnpjAConfirmar({ corpo: '', vazia: true }, false), null);
  assert.equal(comCnpjAConfirmar({ corpo: 'O CNPJ está a confirmar.', vazia: false }, false), null);
});

test('<fontes-disponiveis>: the common instruction closes the user message of the three synthesis calls', () => {
  const fim = `${INSTRUCAO_FONTES}\nResponda no esquema.`;
  const dados = '<ficha>\n</ficha>';
  for (const m of [mensagemEnquadrar(dados), mensagemConversa(dados, {}, { destino: 'convidar', modificadores: {} }), mensagemMontar(dados, {}, {}, 'A0 (fora)')]) {
    assert.equal(m[0].texto, dados, 'the data block is unchanged');
    assert.ok(m.at(-1).texto.endsWith(fim));
  }
});

test('reparar: an explicit model ID in config/pipeline.modelos.reparar wins over the stage that wrote the text', () => {
  const config = {
    modelos: { enquadrar: 'claude-sonnet-5-5', preparar_conversa: 'claude-sonnet-5-5', montar_analise: 'claude-sonnet-5-5', reparar: 'claude-sonnet-5-5', corrigir: null },
    esforco: { enquadrar: 'medio', preparar_conversa: 'medio', montar_analise: 'medio', reparar: null, corrigir: null },
  };
  // Design C: Haiku 5.5 in preparar_conversa and montar_analise by run parameters.
  const c = comParametros(config, { modelos: { preparar_conversa: 'claude-haiku-5-5', montar_analise: 'claude-haiku-5-5' } });
  assert.equal(modeloDe(c, 'reparar', 'montar_analise'), 'claude-sonnet-5-5');
  assert.equal(modeloDe(c, 'reparar', 'preparar_conversa'), 'claude-sonnet-5-5');
  assert.equal(esforcoDe(c, 'reparar', 'montar_analise'), 'medio');
  assert.equal(modeloDe(c, 'corrigir'), 'claude-haiku-5-5', 'corrigir still follows montar_analise');
  // Without it, the repair follows the stage, as before.
  const sem = comParametros({ ...config, modelos: { ...config.modelos, reparar: null } }, { modelos: { montar_analise: 'claude-haiku-5-5' } });
  assert.equal(modeloDe(sem, 'reparar', 'montar_analise'), 'claude-haiku-5-5');
});
