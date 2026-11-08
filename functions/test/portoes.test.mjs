// Phase 2 – code gates with repair (spec 02 v0.12, 1.2, 3.4 and 4.1): the new rules, the wider reach, the
// method lists, the repair acceptance and the Phase B texts of 7/11/2026 as fixtures
// (test/fixtures/fase-b.json, taken from comparacao-analises.html; signatory names are the fictitious ones of
// the test fichas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ETAPAS_COLETA, coletaDe, fontesDisponiveis, blocoDados } from '../lib/sintese.js';
import {
  avisosDaColeta, checagens, folhasDaAnalise, grausSemNome, horarioConcreto, numerosSemFonte, ordemDeDatasInvertida, saudacaoComNome,
  siglasSemExtenso, telefonesFora, vaiAoReparo,
} from '../lib/verificacao.js';
import { nomesDosGraus, regrasDoMetodo, secaoDoMetodo, termosVetados } from '../lib/metodoRegras.js';
import { avaliaReparo, camposDaEtapa, itensDeReparo, jsonDaEtapa, localNaEtapa, mede, mensagemReparar, simulaReparo } from '../lib/reparo.js';

const raiz = new URL('../../metodo/', import.meta.url);
const arquivos = Object.fromEntries(['glossario.md', 'escopo-limites.md', 'portas-materiais.md', 'mapa-alavancas.md', 'livro-selecao.md'].map((n) => [n, readFileSync(new URL(n, raiz), 'utf8')]));
const regras = regrasDoMetodo(arquivos);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/fase-b.json', import.meta.url), 'utf8'));
const versao = (ficha, v) => fixture.versoes.find((x) => x.ficha.startsWith(ficha) && x.versao === v);
const coletaDaVersao = (v) => coletaDe(Object.fromEntries(ETAPAS_COLETA.map((e) => [e, {
  status: 'concluida', conteudo: {}, afirmacoes: [], fontes: Array.from({ length: v.fontes[e] ?? 0 }, (_, i) => ({ url: `https://fonte.example/${e}/${i}` })),
}])));
const analiseDe = (v) => ({
  secoes: v.secoes, resumoExecutivo: v.resumoExecutivo, rascunhoResposta: v.rascunhoResposta, enquadramento: v.enquadramento, conversa: v.conversa,
  nome: v.nome, lang: 'pt-BR', cnpjConfirmado: true,
});
const checaVersao = (v) => checagens(analiseDe(v), coletaDaVersao(v), regras);
const doTipo = (p, regra) => p.filter((x) => x.regra === regra);

// --- Method lists -------------------------------------------------------------------------------------

test('method: vetoed terms of glossario.md Part C, grade names of escopo-limites.md section 6, cited sections', () => {
  assert.deepEqual(termosVetados(arquivos['glossario.md']).map((t) => t.vetado), ['chute', 'executivo de tecnologia', 'concorrente']);
  assert.equal(termosVetados(arquivos['glossario.md'])[0].preferido, 'especulação sem lastro');
  assert.deepEqual(termosVetados('## Parte C – Regras\n\nsem lista\n'), []);
  assert.deepEqual(nomesDosGraus(arquivos['escopo-limites.md']), { A4: 'núcleo', A3: 'alta', A2: 'parcial', A1: 'marginal', A0: 'fora' });
  assert.match(secaoDoMetodo(arquivos, 'escopo-limites', '1'), /^## 1\. Cliente aderente/);
  assert.match(secaoDoMetodo(arquivos, 'glossario.md', 'Parte C'), /^## Parte C/);
  assert.equal(secaoDoMetodo(arquivos, 'escopo-limites', '99'), null);
  assert.equal(secaoDoMetodo(arquivos, 'nao-existe', '1'), null);
});

// --- <fontes-disponiveis> -------------------------------------------------------------------------------

test('fontes-disponiveis: index ranges, stages without sources named as such, right after the ficha', () => {
  const c = coletaDaVersao({ fontes: { empresa_registro: 4, empresa_digital: 1, mercado: 14 } });
  const b = fontesDisponiveis(c);
  assert.match(b, /empresa_registro: 0-3\n/);
  assert.match(b, /empresa_digital: 0\n/);
  assert.match(b, /setor: sem fontes indexadas – não cite \[F:setor:n\]/);
  assert.match(b, /mercado: 0-13\n<\/fontes-disponiveis>\nCite fontes apenas pelos índices/);
  const d = blocoDados({ nome: 'Ana Teste', empresa: 'X', cargo: 'ceo', rotuloCargo: 'CEO', dominioEmail: 'x.com', site: null, mensagem: null, pagina: null, lang: 'pt-BR' }, null, c);
  assert.ok(d.indexOf('</ficha>\n<fontes-disponiveis>') > 0 && d.indexOf('<fontes-disponiveis>') < d.indexOf('<qualificacao>'));
  assert.deepEqual(avisosDaColeta(c).sort(), ['etapa_sem_fontes: empresa_noticias', 'etapa_sem_fontes: empresa_pessoas', 'etapa_sem_fontes: setor']);
});

// --- New rules, on the Phase B texts ----------------------------------------------------------------------

test('Phase B: concrete times and missing name in the draft (Capal v2, GAT v2 and v3)', () => {
  const capal = checaVersao(versao('Capal', 'v2'));
  assert.match(doTipo(capal, 'rascunho_horario_concreto')[0].trecho, /terça-feira às 10h/);
  assert.equal(doTipo(capal, 'rascunho_sem_nome').length, 1);
  assert.match(doTipo(checaVersao(versao('GAT', 'v2')), 'rascunho_horario_concreto')[0].trecho, /às 10h/);
  assert.equal(doTipo(checaVersao(versao('GAT', 'v3')), 'rascunho_sem_nome').length, 1);
  // Drafts that greet by name pass.
  assert.equal(doTipo(checaVersao(versao('GAT', 'v1')), 'rascunho_sem_nome').length, 0);
  assert.ok(saudacaoComNome('Olá, Bruno.\n\nObrigado.', 'Bruno Teste'));
  assert.ok(!saudacaoComNome('Olá, obrigado pelo contato.', 'Bruno Teste'));
  assert.equal(horarioConcreto('Podemos conversar em [opção de horário 1] ou [opção de horário 2]?'), null);
  assert.ok(horarioConcreto('Que tal às 15 horas?'));
});

test('Phase B: source marks pointing nowhere, in enquadramento and conversa too (Ciser v2, GAT v1)', () => {
  const ciser = doTipo(checaVersao(versao('Ciser', 'v2')), 'marca_sem_destino');
  assert.ok(ciser.some((x) => x.trecho === '[F:empresa_digital:25]' && x.local === 'enquadramento.detalhe.riscosDoLead[0].sinal' && x.secao === 'enquadramento'));
  assert.ok(ciser.some((x) => x.local.startsWith('conversa.perguntas[')));
  const gat = doTipo(checaVersao(versao('GAT', 'v1')), 'marca_sem_destino');
  assert.ok(gat.some((x) => x.trecho === '[F:setor:sem_idx]'));
  assert.ok(gat.some((x) => x.trecho === '[F:qualificacao:mensagem]'));
  // GAT's setor collection came without a source list: [F:setor:n] has no destination.
  assert.ok(doTipo(checaVersao(versao('GAT', 'v2')), 'marca_sem_destino').some((x) => x.trecho === '[F:setor:8]'));
});

test('Phase B: reversed date order (Ciser v1) and grades without name (Capal v1)', () => {
  const ciser = doTipo(checaVersao(versao('Ciser', 'v1')), 'ordem_datas');
  assert.equal(ciser.length, 1);
  assert.match(ciser[0].trecho, /setembro de 2026\) é posterior ao status do PL \(25\/10\/2026\)/);
  assert.ok(doTipo(checaVersao(versao('Capal', 'v1')), 'grau_sem_nome').some((x) => /Execução A3 e assessoria A4/.test(x.trecho)));
  // "A4 – núcleo" carries the name (GAT v1, s5).
  assert.ok(!doTipo(checaVersao(versao('GAT', 'v1')), 'grau_sem_nome').some((x) => /A4 – núcleo/.test(x.trecho)));
});

test('Phase B: vetoed terms, "concorrente" allowed in a sentence with a source mark', () => {
  const elite = doTipo(checaVersao(versao('Elite', 'v3')), 'termo_vetado');
  assert.ok(elite.some((x) => /seria chute/.test(x.trecho)));
  const capal = doTipo(checaVersao(versao('Capal', 'v1')), 'termo_vetado');
  // "concorrente paranaense divulga IA ... [F:setor:3]" has a source in the same sentence.
  assert.ok(!capal.some((x) => /concorrente paranaense/.test(x.trecho)));
  const t = checagens({ ...analiseDe(versao('Capal', 'v1')), secoes: { ...versao('Capal', 'v1').secoes, s1: { corpo: `${'palavra '.repeat(45)}Os concorrentes da região não foram verificados.`, vazia: false } } }, coletaDaVersao(versao('Capal', 'v1')), regras);
  assert.ok(doTipo(t, 'termo_vetado').some((x) => x.secao === 's1' && /concorrentes/.test(x.trecho)));
  // "glue work" is a book term and is not vetoed.
  assert.ok(!regras.vetados.some((v) => /glue/i.test(v.vetado)));
});

test('Phase B: the LinkedIn job identifier is not a phone; numbers in the text still are', () => {
  for (const v of ['v1', 'v2', 'v3']) assert.equal(doTipo(checaVersao(versao('Ciser', v)), 'dados_pessoais').length, 0);
  assert.deepEqual(telefonesFora('Vaga [x](https://br.linkedin.com/jobs/view/analista-pl-at-ciser-2936086455) e (47) 3333-1234.', ''), ['(47) 3333-1234']);
});

test('numbers: [M:arquivo:seção] is a source when the number is in the cited section', () => {
  const frase = 'A prática atende empresas com receita anual de R$ 4,8 milhões a R$ 300 milhões.';
  assert.equal(numerosSemFonte(frase, arquivos).length, 1);
  assert.equal(numerosSemFonte(`${frase.slice(0, -1)} [M:escopo-limites:1].`, arquivos).length, 0);
  // A number that is not in the cited section keeps the issue.
  assert.equal(numerosSemFonte('A prática atende empresas com receita de R$ 9,9 milhões [M:escopo-limites:1].', arquivos).length, 1);
  assert.equal(numerosSemFonte(`${frase.slice(0, -1)} [M:escopo-limites:6].`, arquivos).length, 1);
});

test('numbers: wider exceptions of spec 02 v0.12 (chapter, CNAE, art., software version, "até N palavras", list after a fragment)', () => {
  for (const t of [
    'O tema está no livro, Cap. 5, e nas seções 1, 3 e 4 do método.',
    'O código CNAE 9313-1/00 descreve condicionamento físico.',
    'A LGPD trata dado de saúde no art. 11 como sensível.',
    'O site roda WordPress 5.6.23, versão desatualizada.',
    'O rascunho tem até 120 palavras e duas opções de horário.',
    'Hipótese. **2. Atendimento a candidatos** com respostas a dúvidas frequentes.',
  ]) assert.deepEqual(numerosSemFonte(t), [], t);
  // Thousands separators are not versions.
  assert.equal(numerosSemFonte('A empresa tem 1.500.000 clientes ativos no país.').length, 1);
});

test('acronyms: list of 26; first occurrence by reading order, enquadramento and conversa apart', () => {
  assert.deepEqual(siglasSemExtenso('A ANVISA e a ANTT regulam; a NF-e e o 3PL também.'), ['ANVISA', 'ANTT', '3PL', 'NF-e']);
  const v = versao('GAT', 'v2');
  const p = doTipo(checaVersao(v), 'sigla');
  assert.ok(p.every((x) => ['enquadramento', 'conversa'].includes(x.secao) || x.local.startsWith('secoes.') || ['resumoExecutivo', 'rascunhoResposta'].includes(x.secao)));
  // Each excerpt is an exact substring of its field.
  const folhas = new Map(folhasDaAnalise(analiseDe(v)).map((f) => [f.local, f.texto]));
  for (const x of p) assert.ok(folhas.get(x.local).includes(x.trecho), x.trecho);
});

test('grades and dates: accepted forms and rule edges', () => {
  const g = regras.graus;
  assert.equal(grausSemNome('Execução A3 (alta) e assessoria A4 · núcleo; alta (A3); A2 – parcial; A1: marginal.', g).length, 0);
  assert.equal(grausSemNome('Execução A3 e assessoria A4.', g).length, 2);
  assert.equal(grausSemNome('Ver https://site.example/A3/x.', g).length, 0);
  assert.equal(grausSemNome('Execução A3.', {}).length, 0);
  assert.equal(ordemDeDatasInvertida('O registro de 10/03/2020 é anterior à notícia de 5 de maio de 2024.').length, 0);
  assert.equal(ordemDeDatasInvertida('O registro de 10/03/2025 é anterior à notícia de 5 de maio de 2024.').length, 1);
  assert.equal(ordemDeDatasInvertida('O dado de outubro de 2026 é posterior a 25/10/2026.').length, 0);
  assert.equal(ordemDeDatasInvertida('O dado é posterior ao relatório, sem datas.').length, 0);
});

test('rules that go to the repair, and the ones that do not', () => {
  const p = checaVersao(versao('Capal', 'v2'));
  const regrasP = new Set(p.filter(vaiAoReparo).map((x) => x.regra));
  for (const r of ['marca_sem_destino', 'rascunho_horario_concreto', 'rascunho_sem_nome', 'termo_vetado', 'grau_sem_nome', 'sigla']) assert.ok(regrasP.has(r), r);
  assert.ok(!vaiAoReparo({ regra: 'numero_sem_fonte' }) && !vaiAoReparo({ regra: 'secao_curta' }) && !vaiAoReparo({ regra: 'dados_pessoais' }) && !vaiAoReparo({ regra: 'tipografia' }) && !vaiAoReparo({ regra: 'cnpj_a_confirmar' }));
});

// --- Repair ------------------------------------------------------------------------------------------------

test('repair: word diff counts only what changed outside the listed excerpts', () => {
  const antes = 'Primeira frase sem mudança. Podemos falar na terça às 10h ou na quinta às 15h. Última frase.';
  const trecho = 'Podemos falar na terça às 10h ou na quinta às 15h.';
  const i = antes.indexOf(trecho);
  const depois = antes.replace(trecho, 'Podemos falar em [opção de horário 1] ou [opção de horário 2].');
  const m = mede(antes, depois, [{ ini: i, fim: i + trecho.length }]);
  assert.equal(m.foraMudados, 0);
  assert.equal(m.depois[0], 'Podemos falar em [opção de horário 1] ou [opção de horário 2].');
  const fora = mede(antes, depois.replace('Última frase.', 'Outra frase final.'), [{ ini: i, fim: i + trecho.length }]);
  assert.ok(fora.foraMudados > 0);
});

const textosDe = (v) => ({
  secoes: Object.fromEntries(Object.entries(v.secoes).map(([s, x]) => [s, { titulo: s, corpo: x.corpo, vazia: x.vazia, motivoVazia: null }])),
  resumoExecutivo: v.resumoExecutivo, rascunhoResposta: v.rascunhoResposta, conversa: v.conversa, enquadramento: { detalhe: v.enquadramento },
});

test('repair: draft fixed within the excerpts is accepted; a changed choice or text outside is rejected', () => {
  const v = versao('Capal', 'v2');
  const p = checaVersao(v);
  const itens = itensDeReparo(p.filter(vaiAoReparo), regras, v.nome);
  // The conversa items of the same stage are left out here, so the stand-in fixes everything listed.
  const lista = itens.get('preparar_conversa').filter((x) => x.local.startsWith('rascunhoResposta'));
  assert.deepEqual(lista.map((x) => x.regra).sort(), ['rascunho_horario_concreto', 'rascunho_sem_nome']);
  assert.equal(lista[0].local, 'rascunhoResposta.corpo');
  assert.match(lista.find((x) => x.regra === 'rascunho_sem_nome').orientacao, /"Olá, Ana,"/);
  const antes = jsonDaEtapa('preparar_conversa', textosDe(v));
  const saida = simulaReparo('preparar_conversa', antes, lista, v.nome);
  const ok = avaliaReparo('preparar_conversa', antes, saida, lista, 0.02);
  assert.equal(ok.aceito, true, ok.motivo);
  assert.ok(ok.registros.every((r) => r.aceito && r.etapa === 'preparar_conversa' && r.local === 'rascunhoResposta.corpo'));
  // The repaired draft passes the two rules.
  const campos = camposDaEtapa('preparar_conversa', ok.saida, textosDe(v), coletaDaVersao(v));
  const depois = checagens({ ...analiseDe(v), rascunhoResposta: campos.rascunhoResposta, conversa: campos.conversa }, coletaDaVersao(v), regras);
  assert.equal(doTipo(depois, 'rascunho_horario_concreto').length + doTipo(depois, 'rascunho_sem_nome').length, 0);
  // A changed material URL (a choice) is rejected.
  const outraEscolha = structuredClone(saida);
  outraEscolha.materiais[0].url = 'https://outro.example/';
  assert.equal(avaliaReparo('preparar_conversa', antes, outraEscolha, lista, 0.02).aceito, false);
  // Rewriting a question outside the list is rejected.
  const fora = structuredClone(saida);
  fora.perguntas[0].pergunta = 'Uma pergunta inteiramente nova, escrita no lugar da original, sem relação com os trechos listados para reparo.';
  fora.perguntas[1].pergunta = 'Outra pergunta nova.';
  const r = avaliaReparo('preparar_conversa', antes, fora, lista, 0.02);
  assert.equal(r.aceito, false);
  assert.match(r.motivo, /mudança fora dos trechos/);
  // Output outside the schema is rejected.
  assert.equal(avaliaReparo('preparar_conversa', antes, { x: 1 }, lista, 0.02).aceito, false);
});

test('repair: stage JSON round trip, local paths and message', () => {
  const v = versao('Ciser', 'v2');
  const t = textosDe(v);
  const montar = jsonDaEtapa('montar_analise', t);
  assert.ok(!/\]\(https?:/.test(montar.s3.corpo), 'links back to bare marks');
  assert.equal(localNaEtapa('secoes.s3.corpo'), 's3.corpo');
  assert.equal(localNaEtapa('conversa.pontosDeAtencao[2]'), 'pontosDeAtencaoParaOConsultor[2]');
  assert.equal(localNaEtapa('enquadramento.detalhe.riscosDoLead[0].sinal'), 'riscosDoLead[0].sinal');
  const ident = avaliaReparo('montar_analise', montar, structuredClone(montar), [], 0.02);
  assert.equal(ident.aceito, true);
  const c = coletaDaVersao(v);
  const campos = camposDaEtapa('montar_analise', ident.saida, t, c);
  assert.match(campos.secoes.s3.corpo, /\[F:setor:0\]\(https:\/\/fonte\.example\/setor\/0\)/);
  const enq = jsonDaEtapa('enquadrar', t);
  const itens = itensDeReparo(checaVersao(v).filter(vaiAoReparo), regras, v.nome).get('enquadrar');
  const msg = mensagemReparar('enquadrar', enq, fontesDisponiveis(c), itens)[0].texto;
  assert.match(msg, /^<fontes-disponiveis>/);
  assert.match(msg, /<reparos>[\s\S]*"local": "riscosDoLead\[0\]\.sinal"[\s\S]*<\/reparos>/);
  assert.match(msg, /Corrija apenas os trechos listados em <reparos>/);
});
