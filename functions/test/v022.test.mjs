// Spec 02 v0.22 (12/11/2026): enquadrar carries the definitions of the four technology categories, the same text
// as qualificar. Origin: round R1i, Ciser – design A read one support-analyst opening as equipe_propria and design C
// as enxuta, with the enquadrar instruction listing only the category names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCAO_ENQUADRAR } from '../lib/sintese.js';
import { DEFINICOES_TECNOLOGIA, promptQualificacao } from '../lib/qualificacao.js';

const DEFINICOES = 'em uma das quatro categorias – `enxuta` (sem executivo de tecnologia, com sinal de TI enxuta, terceirizada ou operacional), `sem_sinal` (nenhum sinal, nem de executivo nem de equipe), `equipe_propria` (equipe de tecnologia própria visível, sem executivo dedicado), `executivo` (CIO, CTO ou diretor de tecnologia identificado) –';

test('technology categories: the definitions keep the text of spec 02, section 1', () => {
  assert.equal(DEFINICOES_TECNOLOGIA, DEFINICOES);
});

test('enquadrar (3.1) carries the same definitions, before the evidence and the tie-break rule', () => {
  assert.ok(INSTRUCAO_ENQUADRAR.includes(`Estrutura de tecnologia: classifique ${DEFINICOES}, com evidência da coleta completa; \`sem_sinal\` só quando`));
  assert.ok(!INSTRUCAO_ENQUADRAR.includes('nas quatro categorias (enxuta, sem_sinal, equipe_propria, executivo)'));
});

test('qualificar (1) keeps its text unchanged', () => {
  const p = promptQualificacao(
    { nome: 'Ana', empresa: 'X', cargo: 'ceo', site: null, mensagem: null }, { email: 'a@x.com.br' }, 'CEO', null, {}, {},
  );
  assert.ok(p.includes(`Classifique também: (a) a estrutura de tecnologia da empresa, ${DEFINICOES}, citando a evidência; \`sem_sinal\` só quando`));
});
