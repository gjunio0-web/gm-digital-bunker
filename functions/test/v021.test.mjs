// Spec 02 v0.21 (12/11/2026): the reviewer does not point at the name in the greeting, the tie-break rule of the
// technology structure in qualificar and enquadrar, and the assistant rule of escopo-limites.md, section 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instrucaoRevisor } from '../lib/verificacao.js';
import { INSTRUCAO_ENQUADRAR } from '../lib/sintese.js';
import { promptQualificacao } from '../lib/qualificacao.js';
import { checklistDoRevisor } from '../lib/metodoRegras.js';

const DESEMPATE = '`sem_sinal` só quando não houver nenhum sinal; com sinais contraditórios, classifique pelo sinal mais recente – o da coleta atual (site, vagas abertas) vale como o mais recente, e o datado (notícia, nota) vale pela data – e registre a contradição na evidência;';

test('reviewer: the name in the greeting is in the list of what it does not point at (4.2)', () => {
  assert.match(instrucaoRevisor([]), /\(marcas de fonte, siglas, graus, termos vetados, forma do rascunho, inclusive o nome na saudação\)\. Não reescreva a análise\./);
});

test('technology structure: tie-break rule in enquadrar (3.1) and qualificar (1)', () => {
  assert.ok(INSTRUCAO_ENQUADRAR.includes(`com evidência da coleta completa; ${DESEMPATE} o porte não é avaliado aqui`));
  const p = promptQualificacao(
    { nome: 'Ana', empresa: 'X', cargo: 'ceo', site: null, mensagem: null }, { email: 'a@x.com.br' }, 'CEO', null, {}, {},
  );
  assert.ok(p.includes(`citando a evidência; ${DESEMPATE} (b) a porta`));
});

test('escopo-limites.md: the assistant rule keeps its name and carries the exception for the platform users', () => {
  const escopo = readFileSync(new URL('../../metodo/escopo-limites.md', import.meta.url), 'utf8');
  const item = checklistDoRevisor(escopo).find((r) => r.regra === 'assistente-conhecimento');
  assert.equal(item.nome, 'assistente de conhecimento interno');
  assert.match(item.texto, /\(para consulta da equipe da empresa\).*Essa regra não se aplica ao assistente de IA para os usuários da plataforma, previsto no Projeto \(seção 3\)\./);
});
