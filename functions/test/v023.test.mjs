// Spec 02 v0.23 (12/11/2026): three exceptions in numero_sem_fonte, the check of the acronyms' official long
// forms (sigla_extenso_errado) and the correction treatment sem_alteracao. The sentences come from the R1j and
// R1i versions (Capal v33 and v35, Ciser v30 and v26, GAT Logística v45, Startup Teste B2 v24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGRAS_DE_REPARO, numerosSemFonte, siglasComExtensoErrado } from '../lib/verificacao.js';
import { INSTRUCAO_REPARAR, itensDeReparo } from '../lib/reparo.js';
import { INSTRUCAO_CORRIGIR, TRATAMENTOS, prontaAposCorrecao } from '../lib/correcao.js';

test('numero_sem_fonte: a book section after "livro" is not a number (spec 02 v0.23, 4.1)', () => {
  for (const t of [
    '**Hipóteses de alavanca.** Todas são hipóteses, sem número de retorno; as lentes são da prática e os eixos críticos são do livro, 5.3.',
    'Eixo crítico provável Confiabilidade & Verificabilidade, conforme os eixos do livro (5.3); a resposta precisa de ancoragem.',
  ]) assert.deepEqual(numerosSemFonte(t), [], t);
  // A number that does not follow "livro" is still a number.
  assert.equal(numerosSemFonte('O livro vendeu 5.300 exemplares no ano.').length, 1);
});

test('numero_sem_fonte: a norm acronym in parentheses before its number is not a number (spec 02 v0.23, 4.1)', () => {
  assert.deepEqual(numerosSemFonte('Divulgam certificação da Organização Internacional de Normalização (ISO) 9001 e máquinas de controle numérico.'), []);
  assert.deepEqual(numerosSemFonte('A norma da Associação Brasileira de Normas Técnicas (NBR) 14724 trata de trabalhos acadêmicos.'), []);
  assert.equal(numerosSemFonte('A unidade (SP) 9001 vendeu muito.').length, 1);
});

test('numero_sem_fonte: the length of a time window is not a number (spec 02 v0.23, 4.1)', () => {
  assert.deepEqual(numerosSemFonte('A informação está fora da janela de 12 meses e serve só como contexto de cargo.'), []);
  assert.deepEqual(numerosSemFonte('Notícias de captação: não encontradas na janela de 12 meses.'), []);
  assert.equal(numerosSemFonte('A operação ficou parada por 12 meses.').length, 1);
});

test('sigla_extenso_errado: wrong long forms are found, official ones are not (spec 02 v0.23, 4.1)', () => {
  const erros = (t) => siglasComExtensoErrado(t).map((e) => [e.sigla, e.escrito]);
  assert.deepEqual(erros('O Código Nacional de Atividade Econômica (CNAE) principal é 2592601.'), [['CNAE', 'Código Nacional de Atividade Econômica']]);
  assert.deepEqual(erros('O Cadastro Nacional de Atividades Econômicas (CNAE, Classificação Nacional de Atividades Econômicas) principal é de transporte.'), [['CNAE', 'Cadastro Nacional de Atividades Econômicas']]);
  for (const t of [
    'A Classificação Nacional de Atividades Econômicas (CNAE) principal é o comércio atacadista.',
    'CNAE (Classificação Nacional de Atividades Econômicas) 4930202.',
    'A Lei Geral de Proteção de Dados (LGPD) e a Lei Geral de Proteção de Dados Pessoais (LGPD) valem.',
    'Cadastro Nacional da Pessoa Jurídica (CNPJ) 08.165.642/0001-52.',
    'Área do cliente com Nota Fiscal eletrônica (NF-e) e boletos.',
    'Analista Contábil de Custos Pleno (PL) em Joinville.',
  ]) assert.deepEqual(erros(t), [], t);
  assert.equal(siglasComExtensoErrado('O Código Nacional de Atividade Econômica (CNAE) principal')[0].oficial, 'Classificação Nacional de Atividades Econômicas');
});

test('sigla_extenso_errado goes to the repair with the official form', () => {
  assert.ok(REGRAS_DE_REPARO.includes('sigla_extenso_errado'));
  assert.ok(INSTRUCAO_REPARAR.includes('sigla sem extenso → acrescente a forma por extenso na primeira ocorrência; forma por extenso errada → troque pela forma oficial indicada (o item de reparo traz a orientação exata, por exemplo: troque "Código Nacional de Atividade Econômica" pela forma oficial "Classificação Nacional de Atividades Econômicas", com a sigla CNAE entre parênteses); ordem de datas invertida'));
  const p = { tipo: 'mecanica', regra: 'sigla_extenso_errado', regraNome: null, secao: 's2', local: 'secoes.s2.corpo', correcaoSugerida: null, trecho: 'O Código Nacional de Atividade Econômica (CNAE) principal é 2592601' };
  const [item] = [...itensDeReparo([p], undefined, 'Bruno').values()][0];
  assert.equal(item.orientacao, 'troque "Código Nacional de Atividade Econômica" pela forma oficial "Classificação Nacional de Atividades Econômicas", com a sigla CNAE entre parênteses');
});

test('correction: treatment sem_alteracao, which does not block analise_pronta (spec 02 v0.23, 4.3)', () => {
  assert.deepEqual([...TRATAMENTOS], ['corrigida', 'sem_alteracao', 'mantida']);
  assert.match(INSTRUCAO_CORRIGIR, /`sem_alteracao`, com a razão em uma frase, quando o trecho já atende à correção sugerida ou quando a sugestão contraria escopo-limites\.md, glossario\.md ou portas-materiais\.md, de modo que o trecho pode ficar como está; ou `mantida`, com a razão em uma frase, quando a correção exigir dado que não está na análise ou não puder ser feita\. Na dúvida entre `sem_alteracao` e `mantida`, use `mantida`\./);
  assert.equal(prontaAposCorrecao([], [{ tratamento: 'corrigida' }, { tratamento: 'sem_alteracao' }]), true);
  assert.equal(prontaAposCorrecao([], [{ tratamento: 'sem_alteracao' }, { tratamento: 'mantida' }]), false);
  assert.equal(prontaAposCorrecao([{ tipo: 'mecanica' }], [{ tratamento: 'sem_alteracao' }]), false);
});
