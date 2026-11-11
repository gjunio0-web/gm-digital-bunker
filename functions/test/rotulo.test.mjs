// Section labels (spec 02 v0.15 and v0.17, 3.3, 3.4 and 4.1, rule bloco_sem_rotulo). The cases come from the corrected
// versions of round R1e of phase B2 (test/fixtures/rotulo-r1e.json: Capal v14, design A, and v16, design C;
// each paragraph cut to its first 100 characters, which is all the rule reads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checagens, falhasDeRotulo, inicioDoParagrafo, paragrafos, rotuloForaDoFormato, rotuloNoFormato, vaiAoReparo } from '../lib/verificacao.js';
import { instrucaoMontar, simulaMontar } from '../lib/sintese.js';
import { INSTRUCAO_REPARAR, avaliaReparo, itensDeReparo } from '../lib/reparo.js';
import { chamadasDeReparo } from '../scripts/relatorio-b2.mjs';

const r1e = JSON.parse(readFileSync(new URL('./fixtures/rotulo-r1e.json', import.meta.url), 'utf8'));
const casos = (secao, ...ps) => falhasDeRotulo(secao, ps.join('\n\n')).map((x) => [x.indice, x.caso]);
const continuacao = 'O nome informado não consta dos quadros societários consultados.';

test('label format: bold, full stop inside the bold, no word limit; case is not checked since v0.17', () => {
  assert.ok(rotuloNoFormato('**Atividade.** Cooperativa agroindustrial do Paraná'));
  assert.ok(rotuloNoFormato('**Estrutura de tecnologia observada.** Não foi encontrado executivo'));
  assert.ok(rotuloNoFormato('**Outras cooperativas e o que divulgam sobre IA.** Texto'));
  assert.ok(rotuloNoFormato('**Objetivo.**'));
  assert.ok(rotuloNoFormato('**atividade.** texto'), 'rotulo_fora_da_lista compares labels without case');
  for (const p of ['Atividade: cooperativa', '**Atividade:** texto', '**Atividade**. texto', '**Atividade.**texto', 'Atividade. Texto']) {
    assert.equal(rotuloNoFormato(p), false, p);
  }
});

test('bold label out of the format: the forms of spec 02 v0.15, (b)', () => {
  for (const p of ['**Rótulo:** texto', '**Rótulo**. texto', '**Rótulo**: texto']) assert.ok(rotuloForaDoFormato(p), p);
  for (const p of ['**Rótulo.** texto', '**rótulo.** texto', 'Rótulo: texto', '**Hipóteses de alavanca** (sem rotina mapeada)', 'Texto com **negrito** no meio.']) {
    assert.equal(rotuloForaDoFormato(p), false, p);
  }
});

test('first paragraph of s2 to s7 (a): R1e openings', () => {
  assert.deepEqual(casos('s2', '**Atividade.** Cooperativa agroindustrial do Paraná', continuacao), []);
  assert.deepEqual(casos('s2', 'Atividade: cooperativa agroindustrial que reúne insumos'), [[0, 'sem_rotulo']]);
  assert.deepEqual(casos('s3', 'Cadeia de valor [inferência, a partir das atividades declaradas]: insumos'), [[0, 'sem_rotulo']]);
  assert.deepEqual(casos('s5', 'Signatário. Cargo declarado no formulário: diretor(a)'), [[0, 'sem_rotulo']]);
  assert.deepEqual(casos('s6', '**Escopo:** resultado aprovado, sem pedido ou dor a avaliar.'), [[0, 'fora_do_formato']]);
  assert.deepEqual(casos('s3', 'A coleta de setor não tem fontes indexadas. Tudo abaixo é leitura não lastreada.'), [[0, 'sem_rotulo']]);
  assert.deepEqual(casos('s4', '- TAM: não estimado.', '**SAM.** Não estimado.'), [[0, 'sem_rotulo']]);
  assert.deepEqual(casos('s4', '# Mercado', '**TAM.** Não estimado.'), [[0, 'sem_rotulo']]);
});

test('a one-paragraph body of s2 to s7 is checked by (a) as well', () => {
  assert.deepEqual(casos('s7', 'Objetivo: entender se a dor principal está na operação.'), [[0, 'sem_rotulo']]);
  assert.deepEqual(casos('s7', '**Objetivo.** Entender se a dor principal está na operação.'), []);
});

test('following paragraphs of s2 to s7 (b): only a bold label out of the format fails', () => {
  const abre = '**Atividade.** Cooperativa agroindustrial.';
  assert.deepEqual(casos('s2', abre, continuacao), []);
  assert.deepEqual(casos('s4', abre, 'Ligação com o problema declarado: a mensagem fala em dúvida sobre onde a IA ajuda.'), []);
  assert.deepEqual(casos('s6', abre, '**Hipóteses de alavanca** (sem rotina mapeada, sem arquétipo).'), []);
  assert.deepEqual(casos('s2', abre, '**Afirmações do site não verificadas:** mais de 1.000 vidas atendidas.'), [[1, 'fora_do_formato']]);
  assert.deepEqual(casos('s2', abre, '**Rótulo**. texto', '**rótulo.** texto', '**Rótulo**: texto'), [[1, 'fora_do_formato'], [3, 'fora_do_formato']]);
  assert.deepEqual(casos('s2', abre, '- item de lista', '**Vagas abertas.** Três vagas.'), []);
});

test('s1: since v0.17 the first paragraph needs a label too, as in s2 to s7', () => {
  assert.deepEqual(casos('s1', 'A Capal Cooperativa Agroindustrial escreveu pelo formulário.', 'Leitura inicial de aderência: parcial.'), [[0, 'sem_rotulo']]);
  assert.deepEqual(casos('s1', '**Empresa:** Ciser, razão social Cia Industrial H. Carlos Schneider.'), [[0, 'fora_do_formato']]);
  assert.deepEqual(casos('s1', '**Empresa.** Ciser, razão social Cia Industrial H. Carlos Schneider.'), []);
});

test('R1e: Capal v14 (design A) fails only on s1, unlabeled before v0.17; Capal v16 (design C) fails on every opening', () => {
  const falhas = (v) => Object.entries(r1e[v]).flatMap(([s, ps]) => falhasDeRotulo(s, ps.join('\n\n')).map((x) => `${s}#${x.indice}:${x.caso}`));
  assert.deepEqual(falhas('v14'), ['s1#0:sem_rotulo']);
  assert.deepEqual(falhas('v16'), ['s1#0:sem_rotulo', 's2#0:sem_rotulo', 's3#0:sem_rotulo', 's4#0:sem_rotulo', 's5#0:sem_rotulo', 's6#0:sem_rotulo', 's7#0:sem_rotulo']);
});

test('checagens: bloco_sem_rotulo per section, with the opening of the paragraph, sent to the repair', () => {
  const secoes = Object.fromEntries(Object.entries(r1e.v16).map(([s, ps]) => [s, { corpo: ps.join('\n\n'), vazia: false }]));
  secoes.s5 = { corpo: '', vazia: true };
  const p = checagens({ secoes, rascunhoResposta: { assunto: 'a', corpo: 'Olá' }, lang: 'pt-BR', cnpjConfirmado: true }, {}).filter((x) => x.regra === 'bloco_sem_rotulo');
  assert.deepEqual(p.map((x) => x.secao), ['s1', 's2', 's3', 's4', 's6', 's7'], 'empty s5 is not checked');
  assert.equal(p[1].trecho, r1e.v16.s2[0].slice(0, 80));
  assert.ok(p.every((x) => x.tipo === 'mecanica' && vaiAoReparo(x)));
});

test('the excerpt drops source links before cutting, so the repair finds it in the stage JSON', () => {
  const p = 'Atividade: cooperativa [F:empresa_digital:0](https://capal.coop.br/site/) com fábrica própria de ração para bovinos.';
  assert.equal(inicioDoParagrafo(p), 'Atividade: cooperativa [F:empresa_digital:0] com fábrica própria de ração para b');
  assert.deepEqual(paragrafos('a\n\n \n\nb\n c'), ['a', 'b\n c']);
});

test('prompts: montar_analise carries the label sentence; reparar covers the block without label', () => {
  assert.match(instrucaoMontar('A0 (nula)'), /Cada subseção começa com um rótulo em negrito, terminado em ponto dentro do negrito, seguido do texto na mesma linha \("\*\*Atividade\.\*\* Texto…"\); os parágrafos seguintes da mesma subseção não levam rótulo\. Use só os rótulos da lista da seção, nesta ordem, cada um uma vez e todos eles;/);
  assert.match(INSTRUCAO_REPARAR, /bloco sem rótulo → no primeiro parágrafo da subseção, acrescente um rótulo curto em negrito[\s\S]*acrescente um rótulo antes dele;/);
  assert.match(INSTRUCAO_REPARAR, /rótulo fora da lista, repetido, fora de ordem ou faltando → use os rótulos da lista da seção, na ordem, movendo o texto para a subseção certa sem reescrevê-lo, e acrescente as subseções que faltarem com uma linha de "não encontrado"\./);
});

test('repair: the guidance depends on the case, and adding the label at the opening is accepted', () => {
  const montar = structuredClone(simulaMontar(false));
  const resto = ' cooperativa agroindustrial do Paraná, com insumos, nutrição animal e grãos [inferência].';
  montar.s2.corpo = `Atividade:${resto}`;
  const pend = [
    { tipo: 'mecanica', regra: 'bloco_sem_rotulo', secao: 's2', local: 'secoes.s2.corpo', trecho: inicioDoParagrafo(montar.s2.corpo), correcaoSugerida: null },
    { tipo: 'mecanica', regra: 'bloco_sem_rotulo', secao: 's3', local: 'secoes.s3.corpo', trecho: '**Rótulo:** texto', correcaoSugerida: null },
  ];
  const lista = itensDeReparo(pend, undefined, 'Ana Teste').get('montar_analise');
  assert.match(lista[0].orientacao, /não começa com rótulo/);
  assert.match(lista[1].orientacao, /corrija o formato do rótulo/);
  const saida = structuredClone(montar);
  saida.s2.corpo = `**Atividade.** Cooperativa${resto.slice(' cooperativa'.length)}`;
  const r = avaliaReparo('montar_analise', montar, saida, [lista[0]], 0.02);
  assert.equal(r.aceito, true, r.motivo);
});

test('simulated analysis opens s1 to s7 with a label', () => {
  const m = simulaMontar(false);
  for (const s of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) assert.ok(rotuloNoFormato(m[s].corpo), s);
});

test('report: repair calls rejected by limiarReparo, apart from other rejections', () => {
  const eventos = [
    { etapa: 'montar_analise', aceito: true, motivo: null },
    { etapa: 'montar_analise', aceito: false, motivo: 'mudança fora dos trechos de 3.4%' },
    { etapa: 'preparar_conversa', aceito: false, motivo: 'chamada falhou' },
  ];
  assert.deepEqual(chamadasDeReparo(eventos), { total: 3, rejeitadasLimiar: 1, rejeitadasOutras: 1 });
  assert.deepEqual(chamadasDeReparo(undefined), { total: 0, rejeitadasLimiar: 0, rejeitadasOutras: 0 });
});
