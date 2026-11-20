// Value chain of the setor stage by activities (spec 02 v0.38 to v0.42; spec 01 v0.46 to v0.49): the 14 refusal
// groups, limits from config/pipeline and their markers in the instruction, fonteIdx re-indexing, the single chain
// order, the three formats of coleta/setor and the s3 instruction, the elo_sem_atores_e_objetos warning, the correction
// round and the guards that need no API (schema hashes, no output_config.format in the collection call).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { formatoInvalido, normalizaEnvelope } from '../lib/coleta/envelope.js';
import {
  ELOS_FIXOS, LIMITES_CADEIA_PADRAO, avisosDaCadeia, cadeiaInvalida, comCadeiaOrdenada, comLimites, formatoDoConteudo, limitesCadeia, ordemDaCadeia,
} from '../lib/coleta/cadeia.js';
import { ErroColeta, chamaColeta, chaveUrl } from '../lib/coleta/claudeColeta.js';
import { CHAVES, instrucaoDaEtapa, mensagemDaEtapa } from '../lib/coleta/etapas.js';
import { ESQUEMAS, INSTRUCOES } from '../lib/coleta/textosSpec.js';
import { PIPELINE_PADRAO } from '../lib/config.js';
import { combinaPipeline } from '../lib/pipeline.js';
import { camposAusentes } from '../lib/seedCampos.js';
import { ESQUEMA_CONVERSA, ESQUEMA_ENQUADRAR, ESQUEMA_MONTAR, coletaDe, formatoDaCadeia, instrucaoMontar, mensagemMontar } from '../lib/sintese.js';
import { avisosDaColeta } from '../lib/verificacao.js';

const elo = (k, extra = {}) => ({ elo: k, nomeDoElo: null, atividade: 'x', atores: ['a'], objetos: ['o'], tipo: 'inferencia', fonteIdx: [], ...extra });
const outro = (nome, depoisDe, extra = {}) => elo('outro', { nomeDoElo: nome, ...(depoisDe === undefined ? {} : { depoisDe }), ...extra });
const cadeiaOk = () => ({
  elos: [elo('suprimento'), elo('producao_operacao'), elo('distribuicao_comercializacao'), elo('servico_relacionamento', { tipo: 'nao_encontrado', atores: [], objetos: [] })],
  atividadesDeApoio: [],
  clienteFinal: { descricao: 'indústrias', tipo: 'inferencia', fonteIdx: [] },
  posicaoDaEmpresa: { elos: [{ elo: 'producao_operacao', nomeDoElo: null, papel: 'produtora' }], tipo: 'inferencia', fonteIdx: [] },
  concentracaoDeMargemOuPoder: null,
});
const conteudoCom = (cadeia) => ({ setor: { nome: 'Alimentos', cadeiaDeValor: cadeia }, concorrentes: [], regulacao: [], pressoes: [], casosDeUsoRecorrentes: [] });
const conteudoOk = () => conteudoCom(cadeiaOk());
// Applies a change to a valid chain and returns the validator answer.
const com = (muda, l) => { const c = conteudoOk(); muda(c.setor.cadeiaDeValor); return cadeiaInvalida(c, l); };
const s = (n, ch = 'a') => ch.repeat(n);

// --- validation: the 14 groups -------------------------------------------------------------------------

test('valid chain: four fixed elos (nao_encontrado counts), empty support list, final client, position, no concentration', () => {
  assert.equal(cadeiaInvalida(conteudoOk()), null);
});

test('group 1: chain not an object (string included), elos or atividadesDeApoio not a list', () => {
  assert.match(com((c) => { c.elos = {}; }), /elos must be a list/);
  assert.match(com((c) => { delete c.atividadesDeApoio; }), /atividadesDeApoio must be a list/);
  assert.match(com((c) => { c.atividadesDeApoio = null; }), /atividadesDeApoio must be a list/);
  const str = conteudoOk(); str.setor.cadeiaDeValor = 'texto antigo';
  assert.match(cadeiaInvalida(str), /must be an object/);
  assert.match(cadeiaInvalida({ setor: null }), /must be an object/);
  assert.match(cadeiaInvalida({}), /must be an object/);
});

test('group 2: each of the four fixed elos is mandatory; the old identifiers are refused', () => {
  for (const f of ELOS_FIXOS) assert.match(com((c) => { c.elos = c.elos.filter((e) => e.elo !== f); }), new RegExp(`mandatory elo\\(s\\): ${f}`), f);
  assert.match(com((c) => { c.elos[0].elo = 'fornecedores_insumos'; }), /elos\[0\]\.elo must be one of/);
  assert.match(com((c) => { c.elos.push(elo('cliente_final')); }), /elos\[4\]\.elo must be one of/);
});

test('group 3: elo outside the list, outro without name, fixed elo with name', () => {
  assert.match(com((c) => { c.elos.push(elo('varejo')); }), /elos\[4\]\.elo must be one of/);
  assert.match(com((c) => { c.elos.push(outro('  ', null)); }), /nomeDoElo is required when elo = outro/);
  assert.match(com((c) => { c.elos.push(outro(null, null)); }), /nomeDoElo is required/);
  assert.match(com((c) => { c.elos[1].nomeDoElo = 'Fabricação'; }), /nomeDoElo must be null in the fixed elo producao_operacao/);
  assert.equal(com((c) => { c.elos[1].nomeDoElo = '   '; }), null); // blank counts as empty
});

test('group 4: repeated pair {elo, nomeDoElo}, with nomeDoElo compared without case and outer spaces', () => {
  assert.match(com((c) => { c.elos.push(elo('suprimento')); }), /repeats the pair \{elo, nomeDoElo\} suprimento/);
  assert.match(com((c) => { c.elos.push(outro('Reciclagem', null), outro(' reciclagem ', null)); }), /repeats the pair/);
  assert.equal(com((c) => { c.elos.push(outro('Reciclagem', null), outro('Logística reversa', null)); }), null);
});

test('group 5: clienteFinal missing is refused; nao_encontrado is valid', () => {
  assert.match(com((c) => { delete c.clienteFinal; }), /clienteFinal is missing/);
  assert.match(com((c) => { c.clienteFinal = null; }), /clienteFinal is missing/);
  assert.equal(com((c) => { c.clienteFinal = { descricao: '', tipo: 'nao_encontrado', fonteIdx: [] }; }), null);
});

test('group 6: posicaoDaEmpresa.elos empty, repeated, absent pair or without papel; several elos accepted', () => {
  assert.match(com((c) => { c.posicaoDaEmpresa.elos = []; }), /posicaoDaEmpresa\.elos must list one or more/);
  assert.match(com((c) => { delete c.posicaoDaEmpresa; }), /posicaoDaEmpresa\.elos must list/);
  assert.match(com((c) => { c.posicaoDaEmpresa.elos.push({ elo: 'producao_operacao', nomeDoElo: null, papel: 'outra' }); }), /posicaoDaEmpresa\.elos repeats an elo/);
  assert.match(com((c) => { c.posicaoDaEmpresa.elos = [{ elo: 'outro', nomeDoElo: 'Reciclagem', papel: 'p' }]; }), /posicaoDaEmpresa\.elos\[0\] is not an elo of elos\[\]/);
  assert.match(com((c) => { c.posicaoDaEmpresa.elos[0].papel = ' '; }), /posicaoDaEmpresa\.elos\[0\]\.papel is required/);
  assert.equal(com((c) => {
    c.elos.push(outro('Reciclagem', null));
    c.posicaoDaEmpresa.elos = [{ elo: 'producao_operacao', nomeDoElo: null, papel: 'produtora' }, { elo: 'outro', nomeDoElo: ' RECICLAGEM', papel: 'operadora' }];
  }), null);
});

test('groups 7 and 13: concentration must point to a pair of elos[] and have a source; null is valid', () => {
  assert.match(com((c) => { c.concentracaoDeMargemOuPoder = { elo: 'outro', nomeDoElo: 'X', texto: 't', fonteIdx: [0] }; }), /must be null or point to an elo/);
  assert.match(com((c) => { c.concentracaoDeMargemOuPoder = { elo: 'suprimento', nomeDoElo: null, texto: 't', fonteIdx: [] }; }), /needs a source/);
  assert.match(com((c) => { c.concentracaoDeMargemOuPoder = { elo: 'suprimento', nomeDoElo: null, texto: 't' }; }), /needs a source/);
  assert.match(com((c) => { c.concentracaoDeMargemOuPoder = 'texto'; }), /must be null or point to an elo/);
  assert.equal(com((c) => { c.concentracaoDeMargemOuPoder = { elo: 'suprimento', nomeDoElo: null, texto: 't', fonteIdx: [0] }; }), null);
  assert.equal(com((c) => { delete c.concentracaoDeMargemOuPoder; }), null);
});

test('group 8: tipo in elos, clienteFinal and position (three values); support only fato or inferencia', () => {
  assert.match(com((c) => { delete c.elos[2].tipo; }), /elos\[2\]\.tipo must be fato, inferencia or nao_encontrado/);
  assert.match(com((c) => { c.elos[0].tipo = 'Fato'; }), /elos\[0\]\.tipo/);
  assert.match(com((c) => { c.clienteFinal.tipo = 'estimativa'; }), /clienteFinal\.tipo must be/);
  assert.match(com((c) => { delete c.posicaoDaEmpresa.tipo; }), /posicaoDaEmpresa\.tipo must be/);
  assert.match(com((c) => { c.atividadesDeApoio = [{ nome: 'TI', atividade: 'x', atores: [], tipo: 'nao_encontrado', fonteIdx: [] }]; }), /atividadesDeApoio\[0\]\.tipo must be fato or inferencia/);
  assert.match(com((c) => { c.atividadesDeApoio = [{ nome: 'TI', atividade: 'x', atores: [], fonteIdx: [] }]; }), /atividadesDeApoio\[0\]\.tipo/);
  for (const t of ['fato', 'inferencia']) assert.equal(com((c) => { c.atividadesDeApoio = [{ nome: 'TI', atividade: 'x', atores: [], tipo: t, fonteIdx: [] }]; }), null, t);
  for (const t of ['fato', 'inferencia', 'nao_encontrado']) {
    assert.equal(com((c) => { c.elos.forEach((e) => { e.tipo = t; }); c.clienteFinal.tipo = t; c.posicaoDaEmpresa.tipo = t; }), null, t);
  }
  assert.equal(com((c) => { c.elos[0] = elo('suprimento', { tipo: 'fato', fonteIdx: [] }); }), null); // fato without source only lowers confidence
});

test('group 9: atores and objetos lists of strings, item ceiling and list ceiling; atores also in support; empty lists valid', () => {
  assert.match(com((c) => { c.elos[0].atores = 'a'; }), /elos\[0\]\.atores must be a list of strings/);
  assert.match(com((c) => { delete c.elos[0].objetos; }), /elos\[0\]\.objetos must be a list of strings/);
  assert.match(com((c) => { c.elos[0].objetos = [1]; }), /objetos must be a list of strings/);
  assert.equal(com((c) => { c.elos[0].atores = [s(40)]; c.elos[0].objetos = [s(40)]; }), null); // at the ceiling
  assert.match(com((c) => { c.elos[0].atores = [s(41)]; }), /longer than 40 characters/);
  assert.equal(com((c) => { c.elos[1].objetos = ['1', '2', '3', '4', '5']; }), null);
  assert.match(com((c) => { c.elos[1].objetos = ['1', '2', '3', '4', '5', '6']; }), /objetos has 6 items; the maximum is 5/);
  assert.equal(com((c) => { c.elos.forEach((e) => { e.atores = []; e.objetos = []; e.tipo = 'fato'; }); }), null);
  const apoio = (atores) => ({ nome: 'TI', atividade: 'x', atores, tipo: 'inferencia', fonteIdx: [] });
  assert.match(com((c) => { c.atividadesDeApoio = [apoio([s(41)])]; }), /atividadesDeApoio\[0\]\.atores has an item longer/);
  assert.match(com((c) => { c.atividadesDeApoio = [apoio(undefined)]; }), /atividadesDeApoio\[0\]\.atores must be a list/);
  assert.equal(com((c) => { c.atividadesDeApoio = [apoio([])]; }), null);
});

test('characters are counted as characters: accents and characters outside the BMP count one each', () => {
  const acentos = 'ção'.repeat(13) + 'é'; // 40 characters
  assert.equal(Array.from(acentos).length, 40);
  assert.equal(com((c) => { c.elos[0].atores = [acentos]; }), null);
  assert.match(com((c) => { c.elos[0].atores = [acentos + 'á']; }), /longer than 40/);
  assert.equal(com((c) => { c.elos[0].atores = ['𝔸'.repeat(40)]; }), null); // 80 UTF-16 units, 40 characters
  assert.equal(com((c) => { c.elos.push(outro('Comercialização própria', null)); }), null); // 23 characters
});

test('groups 10 and 11: at most 6 elos and 2 support activities (defaults)', () => {
  assert.equal(com((c) => { c.elos.push(outro('A', null), outro('B', null)); }), null);
  assert.match(com((c) => { c.elos.push(outro('A', null), outro('B', null), outro('C', null)); }), /elos has 7 elos; the maximum is 6/);
  const ap = (n) => ({ nome: n, atividade: 'x', atores: [], tipo: 'fato', fonteIdx: [0] });
  assert.equal(com((c) => { c.atividadesDeApoio = [ap('TI'), ap('RH')]; }), null);
  assert.match(com((c) => { c.atividadesDeApoio = [ap('TI'), ap('RH'), ap('Jurídico')]; }), /atividadesDeApoio has 3 items; the maximum is 2/);
});

test('group 12: nomeDoElo at most 24 characters (outer spaces not counted)', () => {
  assert.equal(com((c) => { c.elos.push(outro(s(24), null)); }), null);
  assert.equal(com((c) => { c.elos.push(outro(` ${s(24)} `, null)); }), null);
  assert.match(com((c) => { c.elos.push(outro(s(25), null)); }), /nomeDoElo is longer than 24 characters/);
});

test('group 14: depoisDe null, absent or a fixed elo in outro; any other value, or non-null in a fixed elo, refused', () => {
  for (const d of [null, undefined, ...ELOS_FIXOS]) assert.equal(com((c) => { c.elos.push(outro('Reciclagem', d)); }), null, String(d));
  for (const d of ['outro', 'varejo', 1, '']) assert.match(com((c) => { c.elos.push(outro('Reciclagem', d)); }), /elos\[4\]\.depoisDe must be null or one of/, String(d));
  assert.match(com((c) => { c.elos[0].depoisDe = 'producao_operacao'; }), /elos\[0\]\.depoisDe must be null in the fixed elo suprimento/);
  assert.equal(com((c) => { c.elos[0].depoisDe = null; }), null);
});

test('limits come from config/pipeline: other values change the validation; missing or invalid values use the default', () => {
  assert.deepEqual(limitesCadeia(undefined), LIMITES_CADEIA_PADRAO);
  assert.deepEqual(limitesCadeia({}), { tetoCaracteresItemCadeia: 40, maxItensListaCadeia: 5, maxElosCadeia: 6, maxAtividadesApoio: 2, tetoCaracteresNomeElo: 24 });
  assert.deepEqual(limitesCadeia({ maxElosCadeia: 0, maxAtividadesApoio: 2.5, tetoCaracteresNomeElo: '30', maxItensListaCadeia: null }), LIMITES_CADEIA_PADRAO);
  const l = limitesCadeia({ maxElosCadeia: 7, tetoCaracteresItemCadeia: 10, maxAtividadesApoio: 4 });
  assert.equal(com((c) => { c.elos.push(outro('A', null), outro('B', null), outro('C', null)); }, l), null);
  assert.match(com((c) => { c.elos[0].atores = [s(11)]; }, l), /longer than 10 characters/);
  const ap = (n) => ({ nome: n, atividade: 'x', atores: [], tipo: 'fato', fonteIdx: [] });
  assert.equal(com((c) => { c.atividadesDeApoio = ['a', 'b', 'c', 'd'].map(ap); }, l), null);
});

test('the five limits are in PIPELINE_PADRAO (seed adds them when missing; absent fields fall back in combinaPipeline)', () => {
  for (const [k, v] of Object.entries(LIMITES_CADEIA_PADRAO)) assert.equal(PIPELINE_PADRAO[k], v, k);
  const faltam = camposAusentes(PIPELINE_PADRAO, { ...PIPELINE_PADRAO, maxElosCadeia: undefined, tetoCaracteresNomeElo: 30 });
  assert.equal('tetoCaracteresNomeElo' in faltam, false); // a stored value is never overwritten
  const semCampos = Object.fromEntries(Object.entries(PIPELINE_PADRAO).filter(([k]) => !(k in LIMITES_CADEIA_PADRAO)));
  assert.deepEqual(Object.keys(camposAusentes(PIPELINE_PADRAO, semCampos)).sort(), Object.keys(LIMITES_CADEIA_PADRAO).sort());
  assert.deepEqual(limitesCadeia(combinaPipeline({})), LIMITES_CADEIA_PADRAO);
  assert.equal(limitesCadeia(combinaPipeline({ maxAtividadesApoio: 3 })).maxAtividadesApoio, 3);
});

// --- texts and markers ----------------------------------------------------------------------------------

test('spec 02 v0.42 texts: setor instruction by activities with the five markers; schema with the new chain', () => {
  assert.match(INSTRUCOES.setor, /^Com o CNAE e a descrição do negócio, situe o setor:.*Use o vocabulário do glossário\.\n\nMapeie a cadeia de valor do setor por atividades\. Elo é uma atividade/s);
  assert.match(INSTRUCOES.setor, /A concentração de mercado \(poucos concorrentes grandes\) não entra aqui: é da etapa `mercado`\.$/);
  assert.doesNotMatch(INSTRUCOES.setor, /Os valores entre ⟨ ⟩ são parâmetros|cláusula própria/); // spec annotation, not sent to the model
  for (const m of ['tetoCaracteresNomeElo', 'maxElosCadeia', 'tetoCaracteresItemCadeia', 'maxItensListaCadeia', 'maxAtividadesApoio']) assert.ok(INSTRUCOES.setor.includes(`⟨${m}⟩`), m);
  assert.ok(INSTRUCOES.setor.includes('`nao_encontrado` não é admitido nos itens de apoio (v0.41)'));
  assert.match(ESQUEMAS.setor, /"elos": \[\{ "elo": "suprimento \| producao_operacao \| distribuicao_comercializacao \| servico_relacionamento \| outro"/);
  assert.match(ESQUEMAS.setor, /"depoisDe": "suprimento \| producao_operacao \| distribuicao_comercializacao \| servico_relacionamento \| null/);
  assert.match(ESQUEMAS.setor, /"atividadesDeApoio": \[\{ "nome": "string", "atividade": "string", "atores": \["string"\], "tipo": "fato \| inferencia", "fonteIdx": \[0\] \}\]/);
  assert.match(ESQUEMAS.setor, /"clienteFinal": \{ "descricao": "string"/);
  assert.match(ESQUEMAS.setor, /"posicaoDaEmpresa": \{ "elos": \[\{ "elo": "id de um elo de elos\[\]", "nomeDoElo": "string\|null", "papel": "string" \}\]/);
  assert.match(ESQUEMAS.setor, /"concentracaoDeMargemOuPoder": \{ "elo": "id de um elo de elos\[\]"/);
  assert.doesNotMatch(ESQUEMAS.setor, /fornecedores_insumos|distribuicao_canais|cliente_final/);
});

test('markers are replaced from config/pipeline; no marker is left; other stages are unchanged', () => {
  const padrao = instrucaoDaEtapa('setor', limitesCadeia(combinaPipeline({})));
  assert.doesNotMatch(padrao, /[⟨⟩]/);
  assert.ok(padrao.includes('em `nomeDoElo` (no máximo 24 caracteres)'));
  assert.ok(padrao.includes('a cadeia tem no máximo 6 elos no total'));
  assert.ok(padrao.includes('cada item com no máximo 40 caracteres e cada lista com até 5 itens'));
  assert.ok(padrao.includes('com no máximo 2 itens e vazia quando não houver informação'));
  const outro = instrucaoDaEtapa('setor', limitesCadeia(combinaPipeline({ maxElosCadeia: 8, tetoCaracteresItemCadeia: 30, maxItensListaCadeia: 4, maxAtividadesApoio: 3, tetoCaracteresNomeElo: 20 })));
  assert.ok(outro.includes('(no máximo 20 caracteres)') && outro.includes('no máximo 8 elos') && outro.includes('no máximo 30 caracteres e cada lista com até 4 itens') && outro.includes('no máximo 3 itens'));
  assert.equal(instrucaoDaEtapa('mercado', LIMITES_CADEIA_PADRAO), INSTRUCOES.mercado);
  assert.equal(comLimites('⟨desconhecido⟩ ⟨maxElosCadeia⟩', LIMITES_CADEIA_PADRAO), '⟨desconhecido⟩ 6');
});

test('the setor user message carries the instruction with values and the new schema', () => {
  const ficha = { nome: 'A', empresa: 'B', cargo: 'c', rotuloCargo: 'c', dominioEmail: 'b.com', site: null, mensagem: null, lang: 'pt' };
  const m = mensagemDaEtapa('setor', ficha, { rotulo: 'qualificacao', valor: {} }, [], {}, instrucaoDaEtapa('setor', LIMITES_CADEIA_PADRAO));
  assert.ok(m.includes('Mapeie a cadeia de valor do setor por atividades'));
  assert.ok(m.includes('no máximo 6 elos no total'));
  assert.doesNotMatch(m, /⟨/);
  assert.ok(m.includes('"elos": [{ "elo": "suprimento'));
});

// --- re-indexing ----------------------------------------------------------------------------------------

const fontes = ['a', 'b', 'c'].map((n) => ({ url: `https://${n}.example/`, titulo: n, tipo: 'busca', consultadoEm: '2026-11-18T00:00:00Z' }));
const agora = '2026-11-19T12:00:00Z';
const envBruto = (conteudo, afirmacoes = [{ texto: 't', tipo: 'fato', fonteIdx: [0] }]) => ({ conteudo, fontes, afirmacoes, confianca: { grau: 'alta', motivo: 'm' } });
const sem1 = new Set([chaveUrl(fontes[0].url), chaveUrl(fontes[2].url)]); // source 1 is removed
const todas = new Set(fontes.map((f) => chaveUrl(f.url)));

test('normalizaEnvelope: fonteIdx of elos, support, final client, position and concentration follow the new list; input not mutated', () => {
  const c = conteudoOk(); const k = c.setor.cadeiaDeValor;
  k.elos[0] = elo('suprimento', { tipo: 'fato', fonteIdx: [0, 1, 2] });
  k.atividadesDeApoio = [{ nome: 'TI', atividade: 'x', atores: [], tipo: 'fato', fonteIdx: [2, 1] }];
  k.clienteFinal = { descricao: 'd', tipo: 'fato', fonteIdx: [2] };
  k.posicaoDaEmpresa = { ...k.posicaoDaEmpresa, tipo: 'fato', fonteIdx: [0, 2] };
  k.concentracaoDeMargemOuPoder = { elo: 'suprimento', nomeDoElo: null, texto: 't', fonteIdx: [1, 2] };
  const bruto = envBruto(c); const copia = JSON.stringify(bruto);
  const r = normalizaEnvelope(bruto, sem1, agora).conteudo.setor.cadeiaDeValor;
  assert.deepEqual(r.elos[0].fonteIdx, [0, 1]);
  assert.deepEqual(r.atividadesDeApoio[0].fonteIdx, [1]);
  assert.deepEqual(r.clienteFinal.fonteIdx, [1]);
  assert.deepEqual(r.posicaoDaEmpresa.fonteIdx, [0, 1]);
  assert.deepEqual(r.posicaoDaEmpresa.elos, k.posicaoDaEmpresa.elos);
  assert.deepEqual(r.concentracaoDeMargemOuPoder.fonteIdx, [1]);
  assert.equal(JSON.stringify(bruto), copia);
});

test('normalizaEnvelope: a fato item that loses every source keeps its type and gives "elo sem fonte", in elos, support, final client and position', () => {
  const casos = {
    elo: (k) => { k.elos[1] = elo('producao_operacao', { tipo: 'fato', fonteIdx: [1] }); },
    apoio: (k) => { k.atividadesDeApoio = [{ nome: 'TI', atividade: 'x', atores: [], tipo: 'fato', fonteIdx: [1] }]; },
    cliente: (k) => { k.clienteFinal = { descricao: 'd', tipo: 'fato', fonteIdx: [1] }; },
    posicao: (k) => { k.posicaoDaEmpresa.tipo = 'fato'; k.posicaoDaEmpresa.fonteIdx = [1]; },
  };
  for (const [nome, muda] of Object.entries(casos)) {
    const c = conteudoOk(); muda(c.setor.cadeiaDeValor);
    const r = normalizaEnvelope(envBruto(c), sem1, agora);
    assert.match(r.confianca.motivo, /elo sem fonte/, nome);
    assert.equal(r.confianca.grau, 'baixa', nome);
    assert.equal(r.confianca.motivo.match(/elo sem fonte/g).length, 1, nome);
  }
  // inferencia losing its source does not count
  const c = conteudoOk(); c.setor.cadeiaDeValor.elos[0].fonteIdx = [1];
  assert.doesNotMatch(normalizaEnvelope(envBruto(c), sem1, agora).confianca.motivo, /elo sem fonte/);
});

test('normalizaEnvelope: concentration emptied by re-indexing goes back to null, without "elo sem fonte"; kept when a source remains', () => {
  const c = conteudoOk(); c.setor.cadeiaDeValor.concentracaoDeMargemOuPoder = { elo: 'suprimento', nomeDoElo: null, texto: 't', fonteIdx: [1] };
  const r = normalizaEnvelope(envBruto(c), sem1, agora);
  assert.equal(r.conteudo.setor.cadeiaDeValor.concentracaoDeMargemOuPoder, null);
  assert.doesNotMatch(r.confianca.motivo, /elo sem fonte/);
  assert.match(r.confianca.motivo, /fonte\(s\) não verificada\(s\) removida\(s\)/);
  const r2 = normalizaEnvelope(envBruto(c), todas, agora);
  assert.deepEqual(r2.conteudo.setor.cadeiaDeValor.concentracaoDeMargemOuPoder.fonteIdx, [1]);
});

test('normalizaEnvelope: everything verified changes nothing; the string chain and the emulator null content pass as before', () => {
  const r = normalizaEnvelope(envBruto(conteudoOk()), todas, agora);
  assert.equal(r.confianca.grau, 'alta');
  assert.deepEqual(r.conteudo, conteudoOk());
  const velho = { setor: { nome: 'x', cadeiaDeValor: 'texto', posicaoDaEmpresa: 'y' }, concorrentes: [], regulacao: [], pressoes: [], casosDeUsoRecorrentes: [] };
  assert.deepEqual(normalizaEnvelope(envBruto(velho), todas, agora).conteudo, velho);
  const b2 = { conteudo: Object.fromEntries(CHAVES.setor.map((k) => [k, null])), fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: 'sim' } };
  assert.equal(normalizaEnvelope(b2, new Set(), agora).conteudo.setor, null);
});

// --- chain order ----------------------------------------------------------------------------------------

const ids = (elos) => elos.map((e) => (e.elo === 'outro' ? `outro:${e.nomeDoElo}` : e.elo));

test('ordemDaCadeia: fixed elos in canonical order wherever they are; outro after its depoisDe; null or absent at the end', () => {
  const elos = [
    outro('Fim1', null), elo('servico_relacionamento'), outro('PosSup', 'suprimento'), elo('distribuicao_comercializacao'),
    outro('Fim2'), elo('producao_operacao'), outro('PosServ', 'servico_relacionamento'), elo('suprimento'),
  ];
  assert.deepEqual(ids(ordemDaCadeia(elos)), [
    'suprimento', 'outro:PosSup', 'producao_operacao', 'distribuicao_comercializacao', 'servico_relacionamento', 'outro:PosServ', 'outro:Fim1', 'outro:Fim2',
  ]);
});

test('ordemDaCadeia: two outro with the same depoisDe keep the array order; data without depoisDe (v0.38, v0.39) leaves outro at the end', () => {
  const elos = [elo('suprimento'), outro('B', 'producao_operacao'), elo('producao_operacao'), outro('A', 'producao_operacao'), elo('distribuicao_comercializacao'), elo('servico_relacionamento')];
  assert.deepEqual(ids(ordemDaCadeia(elos)), ['suprimento', 'producao_operacao', 'outro:B', 'outro:A', 'distribuicao_comercializacao', 'servico_relacionamento']);
  const antigo = [outro('X'), ...cadeiaOk().elos];
  assert.deepEqual(ids(ordemDaCadeia(antigo)), [...ELOS_FIXOS, 'outro:X']);
  assert.equal(ordemDaCadeia(antigo).length, antigo.length); // no elo lost or doubled
});

test('comCadeiaOrdenada: orders format (c) only, as a copy; formats (a) and (b) and null are returned as they are', () => {
  const c = conteudoOk(); c.setor.cadeiaDeValor.elos.reverse(); const copia = JSON.stringify(c);
  assert.deepEqual(ids(comCadeiaOrdenada(c).setor.cadeiaDeValor.elos), [...ELOS_FIXOS]);
  assert.equal(JSON.stringify(c), copia);
  const b = { setor: { cadeiaDeValor: { elos: [{ elo: 'cliente_final' }, { elo: 'fornecedores_insumos' }], posicaoDaEmpresa: {} } } };
  assert.equal(comCadeiaOrdenada(b), b);
  assert.equal(comCadeiaOrdenada(null), null);
});

test('coletaDe delivers setor in format (c) with the elos in chain order; the other stages are not touched', () => {
  const c = conteudoOk(); c.setor.cadeiaDeValor.elos = [outro('Fim', null), ...c.setor.cadeiaDeValor.elos.reverse()];
  const col = coletaDe({ setor: { status: 'concluida', conteudo: c, afirmacoes: [], fontes: [] } });
  assert.deepEqual(ids(col.setor.conteudo.setor.cadeiaDeValor.elos), [...ELOS_FIXOS, 'outro:Fim']);
});

// --- formats and the s3 instruction -----------------------------------------------------------------------

const bloco = (conteudo, extra = {}) => ({ status: 'concluida', usavel: true, conteudo, afirmacoes: [], fontes: [], ...extra });
const cadeiaB = () => ({
  elos: [{ elo: 'fornecedores_insumos', nomeDoElo: null, descricao: 'x', tipo: 'inferencia', fonteIdx: [] }],
  posicaoDaEmpresa: { elo: 'fornecedores_insumos', nomeDoElo: null, papel: 'p', tipo: 'inferencia', fonteIdx: [] },
  concentracaoDeMargemOuPoder: null,
});

test('formatoDoConteudo and formatoDaCadeia: (a) string, null or absent; (b) object without clienteFinal; (c) with clienteFinal', () => {
  assert.equal(formatoDoConteudo({ setor: { cadeiaDeValor: 'texto' } }), 'texto');
  assert.equal(formatoDoConteudo({ setor: null }), 'texto');
  assert.equal(formatoDoConteudo(null), 'texto');
  assert.equal(formatoDoConteudo({}), 'texto');
  assert.equal(formatoDoConteudo(conteudoCom(cadeiaB())), 'objeto');
  assert.equal(formatoDoConteudo(conteudoOk()), 'atividades');
  assert.equal(formatoDoConteudo(conteudoCom({ ...cadeiaB(), clienteFinal: null })), 'atividades'); // the key decides
  assert.equal(formatoDaCadeia({ setor: bloco(conteudoOk()) }), 'atividades');
  assert.equal(formatoDaCadeia({ setor: bloco(conteudoCom(cadeiaB())) }), 'objeto');
  assert.equal(formatoDaCadeia({ setor: bloco(conteudoOk(), { status: 'falhou', usavel: false }) }), 'texto');
  const pres = { blocos: ['etapa'], desde: '2026-11-10T00:00:00Z' };
  const docs = (conteudo, preservado) => ({ setor: { status: 'falhou', conteudo, afirmacoes: [], fontes: [], ...(preservado ? { preservado } : {}) } });
  assert.equal(formatoDaCadeia(coletaDe(docs(conteudoOk(), pres))), 'atividades');
  assert.equal(formatoDaCadeia(coletaDe(docs(conteudoCom(cadeiaB()), pres))), 'objeto');
  assert.equal(formatoDaCadeia(coletaDe(docs(conteudoOk()))), 'texto');
});

test('instrucaoMontar: three versions differing only in the parenthesis of the s3 chain label (literal texts of 3.3)', () => {
  const t = instrucaoMontar('A0 (nula)');
  const o = instrucaoMontar('A0 (nula)', 'objeto');
  const a = instrucaoMontar('A0 (nula)', 'atividades');
  assert.equal(instrucaoMontar('A0 (nula)', 'texto'), t);
  assert.match(t, /\*\*Cadeia de valor e posição da empresa\.\*\* · \*\*Outras empresas do segmento e IA\.\*\*/);
  assert.match(o, /em ordem – fornecedores e insumos, produção e operação, distribuição e canais, cliente final, e os elos `outro` ao fim –, com o elo da empresa destacado/);
  assert.ok(a.includes('**Cadeia de valor e posição da empresa.** (todos os elos dentro deste rótulo único, sem rótulo por elo, nesta ordem: cada elo de `setor.cadeiaDeValor.elos`, na ordem da cadeia (seção 2.5) – suprimento, produção e operação, distribuição e comercialização, serviço e relacionamento, com cada elo `outro` depois do elo indicado em `depoisDe`, ou ao fim quando `depoisDe` é nulo –, com a atividade, os atores e os objetos; depois as atividades de apoio, quando houver; depois o cliente final, como destino da cadeia; depois a posição da empresa, destacada, com o papel dela em cada elo em que atua; por fim a concentração de margem ou poder entre os elos, quando houver; não condense em uma frase genérica; a concentração de mercado fica na **Dinâmica.** da s4) · **Outras empresas do segmento e IA.**'));
  const linhas = (x) => x.split('\n');
  for (const v of [o, a]) {
    const dif = linhas(t).map((l, i) => (l === linhas(v)[i] ? null : i)).filter((i) => i !== null);
    assert.equal(dif.length, 1);
    assert.match(linhas(t)[dif[0]], /^- \*\*s3:\*\*/);
  }
});

test('mensagemMontar passes the chosen version; the old call shape keeps the current instruction', () => {
  const lead = { destino: 'convidar', modificadores: [] };
  const txt = (m) => m.map((b) => b.texto).join('\n');
  assert.doesNotMatch(txt(mensagemMontar('d', {}, {}, lead, 'A0 (nula)')), /setor\.cadeiaDeValor\.elos/);
  assert.match(txt(mensagemMontar('d', {}, {}, lead, 'A0 (nula)', 'atividades')), /na ordem da cadeia/);
});

// --- elo_sem_atores_e_objetos warning ---------------------------------------------------------------------

test('avisosDaCadeia: fato or inferencia elos with atores and objetos both empty, in chain order, outro with its name', () => {
  const c = conteudoOk(); const k = c.setor.cadeiaDeValor;
  k.elos = [
    outro(' Reciclagem ', null, { atores: [], objetos: [], tipo: 'fato' }),
    elo('servico_relacionamento', { atores: [], objetos: [], tipo: 'nao_encontrado' }), // nao_encontrado: no warning
    elo('distribuicao_comercializacao', { atores: [], objetos: ['o'] }), // one list filled: no warning
    elo('producao_operacao', { atores: [], objetos: [] }),
    elo('suprimento', { atores: [], objetos: [], tipo: 'fato' }),
  ];
  assert.deepEqual(avisosDaCadeia(c), [
    'elo_sem_atores_e_objetos: suprimento', 'elo_sem_atores_e_objetos: producao_operacao', 'elo_sem_atores_e_objetos: outro (Reciclagem)',
  ]);
  assert.deepEqual(avisosDaCadeia(conteudoOk()), []);
  assert.deepEqual(avisosDaCadeia(conteudoCom(cadeiaB())), []); // format (b) has no atores and objetos
  assert.deepEqual(avisosDaCadeia({ setor: { cadeiaDeValor: 'texto' } }), []);
  assert.deepEqual(avisosDaCadeia(null), []);
});

test('avisosDaColeta adds the elo warnings after etapa_sem_fontes, from the setor content that enters the synthesis', () => {
  const c = conteudoOk(); c.setor.cadeiaDeValor.elos[0].atores = []; c.setor.cadeiaDeValor.elos[0].objetos = [];
  const fonte = [{ url: 'https://x.example/' }];
  const col = coletaDe({ setor: { status: 'concluida', conteudo: c, afirmacoes: [], fontes: fonte } });
  const avisos = avisosDaColeta(col);
  assert.ok(avisos.includes('elo_sem_atores_e_objetos: suprimento'));
  assert.ok(!avisos.includes('etapa_sem_fontes: setor'));
  assert.equal(avisos.at(-1), 'elo_sem_atores_e_objetos: suprimento');
  const falhou = coletaDe({ setor: { status: 'falhou', conteudo: c, afirmacoes: [], fontes: fonte } });
  assert.equal(avisosDaColeta(falhou).some((a) => a.startsWith('elo_sem')), false); // unusable stage: no content, no warning
});

// --- guards that need no API ----------------------------------------------------------------------------

const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('output schemas of enquadrar, preparar_conversa and montar_analise did not change with the value chain; preparar_conversa changed only by ligadaA (hash)', () => {
  assert.equal(hash(ESQUEMA_ENQUADRAR), 'c987f7901152fe0981e292867f869baf039cfc08e1f859555c94886a640c40a7');
  assert.equal(hash(ESQUEMA_CONVERSA), 'acd9ec21945464d47cd8b3970e37e4aafc52d29706ce214e1e39308a5da8c27e'); // changed on purpose by ligadaA (spec 02 v0.43)
  assert.equal(hash(ESQUEMA_MONTAR), '9f63dc8c6160e7516a0d080684ed91ec52e0fcf9e60f553d6bd1afb1d2b4ed9c');
});

function simulaApi(respostas) {
  const corpos = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    corpos.push(JSON.parse(init.body));
    const texto = respostas[Math.min(corpos.length - 1, respostas.length - 1)];
    return new Response(JSON.stringify({ content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { corpos, restaura: () => { globalThis.fetch = original; } };
}
// The validator as wired in the engine (motor.ts): envelope shape, then the chain with the configured limits.
const pedido = (extra = {}, l = LIMITES_CADEIA_PADRAO) => ({
  chave: 'k', modelo: 'm', esforco: 'low', metodo: [], usuario: 'u', maxBuscas: 4, maxLeituras: 2,
  valida: (j) => formatoInvalido(j, CHAVES.setor) ?? cadeiaInvalida(j.conteudo, l), ...extra,
});
const envelope = (conteudo) => JSON.stringify({ conteudo, fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: 'x' } });

test('collection call has no output_config.format (citations are refused with it); only effort is sent', async () => {
  const api = simulaApi([envelope(conteudoOk())]);
  try {
    const r = await chamaColeta(pedido());
    assert.equal(api.corpos.length, 1);
    assert.deepEqual(api.corpos[0].output_config, { effort: 'low' });
    assert.ok(r.json);
  } finally { api.restaura(); }
});

test('setor: a refused chain gets one correction round in the same conversation, naming the refusal; both rounds in uso.partes', async () => {
  const ruim = conteudoOk(); ruim.setor.cadeiaDeValor.atividadesDeApoio = [{ nome: 'TI', atividade: 'x', atores: [], tipo: 'nao_encontrado', fonteIdx: [] }];
  const api = simulaApi([envelope(ruim), envelope(conteudoOk())]);
  try {
    const r = await chamaColeta(pedido());
    assert.equal(api.corpos.length, 2);
    assert.equal(r.uso.partes.length, 2);
    const msgs = api.corpos[1].messages;
    assert.equal(msgs.length, 3); // original request, first answer, correction
    assert.match(msgs.at(-1).content, /atividadesDeApoio\[0\]\.tipo must be fato or inferencia.*Sem novas buscas/s);
    assert.equal(cadeiaInvalida(r.json.conteudo), null);
  } finally { api.restaura(); }
});

test('setor: a second failure ends the call with "invalid answer after correction" (the engine then marks the stage falhou)', async () => {
  const ruim = conteudoOk(); ruim.setor.cadeiaDeValor.elos.push(outro('A', null), outro('B', null), outro('C', null));
  const api = simulaApi([envelope(ruim)]);
  try {
    await assert.rejects(chamaColeta(pedido()), (e) => e instanceof ErroColeta && /invalid answer after correction/.test(e.message) && e.parcial.uso.partes.length === 2);
    assert.equal(api.corpos.length, 2);
    assert.match(api.corpos[1].messages.at(-1).content, /elos has 7 elos; the maximum is 6/);
  } finally { api.restaura(); }
});

test('setor: the configured limits reach the validator of the call (7 elos accepted with maxElosCadeia = 7)', async () => {
  const sete = conteudoOk(); sete.setor.cadeiaDeValor.elos.push(outro('A', null), outro('B', null), outro('C', null));
  const api = simulaApi([envelope(sete)]);
  try {
    await chamaColeta(pedido({}, limitesCadeia({ maxElosCadeia: 7 })));
    assert.equal(api.corpos.length, 1);
  } finally { api.restaura(); }
});
