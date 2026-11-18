// Structured value chain of the setor stage (spec 02 v0.33 to v0.35): validation, correction round, fonteIdx
// reindexing, texts, choice of the s3 instruction by format, and the guards that need no API (schema hashes,
// no output_config.format in the collection call).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cadeiaInvalida, formatoInvalido, normalizaEnvelope } from '../lib/coleta/envelope.js';
import { ErroColeta, chamaColeta, chaveUrl } from '../lib/coleta/claudeColeta.js';
import { CHAVES, mensagemDaEtapa } from '../lib/coleta/etapas.js';
import { ESQUEMAS, INSTRUCOES } from '../lib/coleta/textosSpec.js';
import { ESQUEMA_CONVERSA, ESQUEMA_ENQUADRAR, ESQUEMA_MONTAR, formatoDaCadeia, instrucaoMontar, mensagemMontar, coletaDe } from '../lib/sintese.js';

const elo = (k, extra = {}) => ({ elo: k, nomeDoElo: null, descricao: 'x', tipo: 'inferencia', fonteIdx: [], ...extra });
const cadeiaOk = () => ({
  elos: [elo('fornecedores_insumos'), elo('producao_operacao'), elo('distribuicao_canais'), elo('cliente_final', { tipo: 'nao_encontrado' })],
  posicaoDaEmpresa: { elo: 'producao_operacao', nomeDoElo: null, papel: 'produtora', tipo: 'inferencia', fonteIdx: [] },
  concentracaoDeMargemOuPoder: null,
});
const conteudoOk = () => ({ setor: { nome: 'Alimentos', cadeiaDeValor: cadeiaOk() }, concorrentes: [], regulacao: [], pressoes: [], casosDeUsoRecorrentes: [] });

test('cadeiaInvalida: accepts the four links (nao_encontrado counts) and a position in the list', () => {
  assert.equal(cadeiaInvalida(conteudoOk()), null);
});

test('cadeiaInvalida: refuses string chain, missing link, position outside the list, outro without name', () => {
  const c1 = conteudoOk(); c1.setor.cadeiaDeValor = 'texto antigo';
  assert.match(cadeiaInvalida(c1), /must be an object/);
  const c2 = conteudoOk(); c2.setor.cadeiaDeValor.elos.pop();
  assert.match(cadeiaInvalida(c2), /cliente_final/);
  const c3 = conteudoOk(); c3.setor.cadeiaDeValor.posicaoDaEmpresa.elo = 'varejo';
  assert.match(cadeiaInvalida(c3), /posicaoDaEmpresa\.elo/);
  const c4 = conteudoOk(); c4.setor.cadeiaDeValor.elos.push(elo('outro', { nomeDoElo: '  ' }));
  assert.match(cadeiaInvalida(c4), /nomeDoElo is required/);
  const c5 = conteudoOk(); c5.setor.cadeiaDeValor.posicaoDaEmpresa = { elo: 'outro', nomeDoElo: null };
  assert.match(cadeiaInvalida(c5), /posicaoDaEmpresa: nomeDoElo/);
  const c6 = conteudoOk(); c6.setor.cadeiaDeValor.elos.push(elo('outro', { nomeDoElo: 'Reciclagem' })); c6.setor.cadeiaDeValor.posicaoDaEmpresa = { elo: 'outro', nomeDoElo: 'Reciclagem', papel: 'p', tipo: 'fato', fonteIdx: [0] };
  assert.equal(cadeiaInvalida(c6), null);
  assert.match(cadeiaInvalida({ setor: null }), /must be an object/);
  assert.match(cadeiaInvalida({}), /must be an object/);
});

test('the setor validator (as wired in the engine) refuses before and after the envelope check', () => {
  const env = (conteudo) => ({ conteudo, fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: 'x' } });
  const valida = (j) => formatoInvalido(j, CHAVES.setor) ?? cadeiaInvalida(j.conteudo);
  assert.equal(valida(env(conteudoOk())), null);
  const velho = conteudoOk(); velho.setor = { nome: 'x', cadeiaDeValor: 'texto', posicaoDaEmpresa: 'y' };
  assert.match(valida(env(velho)), /must be an object/);
});

// --- reindexing -------------------------------------------------------------------------------------

const fontes = ['a', 'b', 'c'].map((n) => ({ url: `https://${n}.example/`, titulo: n, tipo: 'busca', consultadoEm: '2026-11-18T00:00:00Z' }));
const agora = '2026-11-18T12:00:00Z';

test('normalizaEnvelope: fonteIdx of elos and position follow the new list; the removed source leaves; input is not mutated', () => {
  const c = conteudoOk();
  c.setor.cadeiaDeValor.elos[0] = elo('fornecedores_insumos', { tipo: 'fato', fonteIdx: [0, 1, 2] });
  c.setor.cadeiaDeValor.posicaoDaEmpresa = { elo: 'producao_operacao', nomeDoElo: null, papel: 'p', tipo: 'fato', fonteIdx: [2] };
  const bruto = { conteudo: c, fontes, afirmacoes: [{ texto: 't', tipo: 'fato', fonteIdx: [2] }], confianca: { grau: 'alta', motivo: 'm' } };
  const copia = JSON.stringify(bruto);
  const verificadas = new Set([chaveUrl(fontes[0].url), chaveUrl(fontes[2].url)]); // source 1 is removed
  const r = normalizaEnvelope(bruto, verificadas, agora);
  assert.deepEqual(r.conteudo.setor.cadeiaDeValor.elos[0].fonteIdx, [0, 1]);
  assert.deepEqual(r.conteudo.setor.cadeiaDeValor.posicaoDaEmpresa.fonteIdx, [1]);
  assert.deepEqual(r.afirmacoes[0].fonteIdx, [1]);
  assert.equal(JSON.stringify(bruto), copia);
  assert.equal(r.confianca.grau, 'baixa'); // removed source lowers it, as before
  assert.doesNotMatch(r.confianca.motivo, /elo sem fonte/);
});

test('normalizaEnvelope: elo fato that loses every source keeps its type and lowers the confidence with "elo sem fonte"', () => {
  const c = conteudoOk();
  c.setor.cadeiaDeValor.elos[1] = elo('producao_operacao', { tipo: 'fato', fonteIdx: [1] });
  const bruto = { conteudo: c, fontes, afirmacoes: [{ texto: 't', tipo: 'fato', fonteIdx: [0] }], confianca: { grau: 'alta', motivo: 'm' } };
  const r = normalizaEnvelope(bruto, new Set([chaveUrl(fontes[0].url), chaveUrl(fontes[2].url)]), agora);
  const e = r.conteudo.setor.cadeiaDeValor.elos[1];
  assert.equal(e.tipo, 'fato');
  assert.deepEqual(e.fonteIdx, []);
  assert.equal(r.confianca.grau, 'baixa');
  assert.match(r.confianca.motivo, /elo sem fonte/);
});

test('normalizaEnvelope: inferencia and nao_encontrado with empty fonteIdx are expected; all sources verified changes nothing', () => {
  const bruto = { conteudo: conteudoOk(), fontes, afirmacoes: [{ texto: 't', tipo: 'fato', fonteIdx: [0] }], confianca: { grau: 'alta', motivo: 'm' } };
  const r = normalizaEnvelope(bruto, new Set(fontes.map((f) => chaveUrl(f.url))), agora);
  assert.equal(r.confianca.grau, 'alta');
  assert.deepEqual(r.conteudo, conteudoOk());
});

test('normalizaEnvelope: content of a collection before v0.33 (string chain) and null content pass as before', () => {
  const velho = { setor: { nome: 'x', cadeiaDeValor: 'texto', posicaoDaEmpresa: 'y' }, concorrentes: [], regulacao: [], pressoes: [], casosDeUsoRecorrentes: [] };
  const b1 = { conteudo: velho, fontes, afirmacoes: [{ texto: 't', tipo: 'fato', fonteIdx: [0] }], confianca: { grau: 'alta', motivo: 'm' } };
  assert.deepEqual(normalizaEnvelope(b1, new Set(fontes.map((f) => chaveUrl(f.url))), agora).conteudo, velho);
  const b2 = { conteudo: Object.fromEntries(CHAVES.setor.map((k) => [k, null])), fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: 'sim' } };
  assert.equal(normalizaEnvelope(b2, new Set(), agora).conteudo.setor, null); // emulator stand-in
});

// --- texts ------------------------------------------------------------------------------------------

test('spec 02 v0.35 texts: setor instruction (two paragraphs) and schema with the structured chain', () => {
  assert.match(INSTRUCOES.setor, /^Com o CNAE e a descrição do negócio, situe o setor:.*Use o vocabulário do glossário\.\n\nMapeie a cadeia de valor do setor:/s);
  assert.match(INSTRUCOES.setor, /O elo sem informação aparece com `tipo = nao_encontrado`, nunca é omitido; o elo que não caiba nos quatro usa `outro`, com o nome em `nomeDoElo`\./);
  assert.match(INSTRUCOES.setor, /A concentração de mercado \(poucos concorrentes grandes\) não entra aqui: é da etapa `mercado`\.$/);
  assert.doesNotMatch(INSTRUCOES.setor, /cláusula própria|v0\.33/); // spec annotation, not sent to the model
  assert.match(ESQUEMAS.setor, /"cadeiaDeValor": \{\n\s+"elos": \[\{ "elo": "fornecedores_insumos \| producao_operacao \| distribuicao_canais \| cliente_final \| outro"/);
  assert.match(ESQUEMAS.setor, /"posicaoDaEmpresa": \{ "elo": "mesma lista de elos"/);
  assert.match(ESQUEMAS.setor, /"concentracaoDeMargemOuPoder": "string\|null/);
  assert.doesNotMatch(ESQUEMAS.setor, /"setor": \{ "nome": "string", "cadeiaDeValor": "string"/);
});

test('the setor user message carries the new instruction and schema', () => {
  const ficha = { nome: 'A', empresa: 'B', cargo: 'c', rotuloCargo: 'c', dominioEmail: 'b.com', site: null, mensagem: null, lang: 'pt' };
  const m = mensagemDaEtapa('setor', ficha, { rotulo: 'qualificacao', valor: {} }, [], {});
  assert.ok(m.includes('Mapeie a cadeia de valor do setor'));
  assert.ok(m.includes('"elos": [{ "elo": "fornecedores_insumos'));
});

// --- s3 instruction by format -----------------------------------------------------------------------

const bloco = (conteudo, status = 'concluida', extra = {}) => ({ status, conteudo, afirmacoes: [], fontes: [], ...extra });
const coletaCom = (setor) => ({ setor });

test('formatoDaCadeia: string, null, absent and unusable stage use the current instruction; object uses the elos instruction', () => {
  assert.equal(formatoDaCadeia(coletaCom({ status: 'concluida', usavel: true, conteudo: { setor: { cadeiaDeValor: 'texto' } } })), 'texto');
  assert.equal(formatoDaCadeia(coletaCom({ status: 'concluida', usavel: true, conteudo: { setor: null } })), 'texto');
  assert.equal(formatoDaCadeia(coletaCom({ status: 'concluida', usavel: true, conteudo: null })), 'texto');
  assert.equal(formatoDaCadeia(coletaCom({ status: 'concluida', usavel: true, conteudo: {} })), 'texto');
  assert.equal(formatoDaCadeia(coletaCom({ status: 'falhou', usavel: false, conteudo: null })), 'texto');
  assert.equal(formatoDaCadeia(coletaCom({ status: null, usavel: false, conteudo: null })), 'texto');
  assert.equal(formatoDaCadeia(coletaCom({ status: 'concluida', usavel: true, conteudo: conteudoOk() })), 'objeto');
});

test('formatoDaCadeia follows the content that enters the synthesis, including a preserved failed stage in either format', () => {
  const docs = (conteudo, status, preservado) => ({ setor: { status, conteudo, afirmacoes: [], fontes: [], ...(preservado ? { preservado } : {}) } });
  const pres = { blocos: ['etapa'], desde: '2026-11-10T00:00:00Z' };
  assert.equal(formatoDaCadeia(coletaDe(docs(conteudoOk(), 'falhou', pres))), 'objeto');
  const velho = { setor: { nome: 'x', cadeiaDeValor: 'texto', posicaoDaEmpresa: 'y' } };
  assert.equal(formatoDaCadeia(coletaDe(docs(velho, 'falhou', pres))), 'texto');
  assert.equal(formatoDaCadeia(coletaDe(docs(conteudoOk(), 'falhou'))), 'texto'); // failed with nothing preserved: no content
});

test('instrucaoMontar: default and "texto" are the current instruction; "objeto" changes only the s3 label parenthesis', () => {
  const t = instrucaoMontar('A0 (nula)');
  assert.equal(instrucaoMontar('A0 (nula)', 'texto'), t);
  const o = instrucaoMontar('A0 (nula)', 'objeto');
  assert.notEqual(o, t);
  assert.match(t, /\*\*Cadeia de valor e posição da empresa\.\*\* · \*\*Outras empresas do segmento e IA\.\*\*/);
  assert.doesNotMatch(t, /setor\.cadeiaDeValor\.elos/);
  assert.match(o, /\*\*Cadeia de valor e posição da empresa\.\*\* \(todos os elos dentro deste rótulo único, sem rótulo por elo: cada elo de `setor\.cadeiaDeValor\.elos`, em ordem – fornecedores e insumos, produção e operação, distribuição e canais, cliente final, e os elos `outro` ao fim –, com o elo da empresa destacado e o papel dela ali; a concentração de margem ou poder entre os elos, quando houver; não condense em uma frase genérica; a concentração de mercado fica na \*\*Dinâmica\.\*\* da s4\) · \*\*Outras empresas do segmento e IA\.\*\*/);
  // the rest is the same in both versions
  const linhas = (s) => s.split('\n');
  const dif = linhas(t).map((l, i) => (l === linhas(o)[i] ? null : i)).filter((i) => i !== null);
  assert.equal(dif.length, 1);
  assert.match(linhas(t)[dif[0]], /^- \*\*s3:\*\*/);
});

test('mensagemMontar passes the chosen version to the model; the old call shape keeps the current instruction', () => {
  const lead = { destino: 'convidar', modificadores: [] };
  const txt = (m) => m.map((b) => b.texto).join('\n');
  assert.doesNotMatch(txt(mensagemMontar('d', {}, {}, lead, 'A0 (nula)')), /setor\.cadeiaDeValor\.elos/);
  assert.match(txt(mensagemMontar('d', {}, {}, lead, 'A0 (nula)', 'objeto')), /setor\.cadeiaDeValor\.elos/);
});

// --- guards that need no API ------------------------------------------------------------------------

const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('output schemas of enquadrar, preparar_conversa and montar_analise did not change with the value chain (hash)', () => {
  assert.equal(hash(ESQUEMA_ENQUADRAR), 'c987f7901152fe0981e292867f869baf039cfc08e1f859555c94886a640c40a7');
  assert.equal(hash(ESQUEMA_CONVERSA), 'f0de247b1a9c16563a7a0ca76ccb81b137d0efc45c17ca6a3f89723cba2b3bbb');
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
const pedido = (extra = {}) => ({
  chave: 'k', modelo: 'm', esforco: 'low', metodo: [], usuario: 'u', maxBuscas: 4, maxLeituras: 2,
  valida: (j) => formatoInvalido(j, CHAVES.setor) ?? cadeiaInvalida(j.conteudo), ...extra,
});
const envelope = (conteudo) => JSON.stringify({ conteudo, fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: 'x' } });

test('collection call has no output_config.format (citations are refused with it); only effort is sent', async () => {
  const api = simulaApi([envelope(conteudoOk())]);
  try {
    const r = await chamaColeta(pedido());
    assert.equal(api.corpos.length, 1);
    assert.deepEqual(api.corpos[0].output_config, { effort: 'low' });
    assert.equal('format' in (api.corpos[0].output_config ?? {}), false);
    assert.ok(r.json);
  } finally { api.restaura(); }
});

test('setor: a chain that fails the validator gets one correction round in the same conversation, both rounds in uso.partes', async () => {
  const ruim = conteudoOk(); ruim.setor.cadeiaDeValor.elos.pop();
  const api = simulaApi([envelope(ruim), envelope(conteudoOk())]);
  try {
    const r = await chamaColeta(pedido());
    assert.equal(api.corpos.length, 2);
    assert.equal(r.uso.partes.length, 2);
    const msgs = api.corpos[1].messages;
    assert.equal(msgs.at(-1).role, 'user');
    assert.match(msgs.at(-1).content, /cliente_final.*Sem novas buscas/s);
    assert.equal(msgs.length, 3); // original request, first answer, correction
    assert.equal(cadeiaInvalida(r.json.conteudo), null);
  } finally { api.restaura(); }
});

test('setor: a second failure ends the call with "invalid answer after correction" (the engine then marks the stage falhou)', async () => {
  const ruim = conteudoOk(); ruim.setor.cadeiaDeValor.elos.pop();
  const api = simulaApi([envelope(ruim)]);
  try {
    await assert.rejects(chamaColeta(pedido()), (e) => e instanceof ErroColeta && /invalid answer after correction/.test(e.message) && e.parcial.uso.partes.length === 2);
    assert.equal(api.corpos.length, 2);
  } finally { api.restaura(); }
});
