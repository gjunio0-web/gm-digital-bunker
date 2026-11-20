// Spec 02 v0.43 (package 1 part): setor.pressoes as {texto, tipo, fonteIdx} with group 15 of the validation, the fill
// rule for a fato pressure without source and the tolerant reading of the string list (E3); conversa.perguntas[].ligadaA
// in preparar_conversa, tolerated when absent in the correction and the repair (E4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizaEnvelope } from '../lib/coleta/envelope.js';
import { LIMITES_CADEIA_PADRAO, pressaoFatoSemFonte, pressoesInvalidas, pressoesLidas, setorInvalido, setorLido } from '../lib/coleta/cadeia.js';
import { chamaColeta, chaveUrl } from '../lib/coleta/claudeColeta.js';
import { CHAVES } from '../lib/coleta/etapas.js';
import { formatoInvalido } from '../lib/coleta/envelope.js';
import { ESQUEMAS, INSTRUCOES } from '../lib/coleta/textosSpec.js';
import { ESQUEMA_CONVERSA, INSTRUCAO_CONVERSA, LIGADA_A, coletaDe, simulaConversa, simulaMontar, validaConversa } from '../lib/sintese.js';
import { validaCorrecao } from '../lib/correcao.js';

const elo = (k, extra = {}) => ({ elo: k, nomeDoElo: null, atividade: 'x', atores: ['a'], objetos: ['o'], tipo: 'inferencia', fonteIdx: [], ...extra });
const conteudo = (pressoes = []) => ({
  setor: { nome: 'Alimentos', cadeiaDeValor: {
    elos: ['suprimento', 'producao_operacao', 'distribuicao_comercializacao', 'servico_relacionamento'].map((k) => elo(k)),
    atividadesDeApoio: [], clienteFinal: { descricao: 'd', tipo: 'inferencia', fonteIdx: [] },
    posicaoDaEmpresa: { elos: [{ elo: 'suprimento', nomeDoElo: null, papel: 'p' }], tipo: 'inferencia', fonteIdx: [] },
    concentracaoDeMargemOuPoder: null,
  } },
  concorrentes: [], regulacao: [], pressoes, casosDeUsoRecorrentes: [],
});
const pressao = (extra = {}) => ({ texto: 'custo de frete', tipo: 'inferencia', fonteIdx: [], ...extra });

// --- E3: pressoes -----------------------------------------------------------------------------------------------

test('group 15: pressoes items are objects with texto filled and tipo fato or inferencia; empty list and fato without source pass', () => {
  assert.equal(setorInvalido(conteudo([])), null);
  assert.equal(setorInvalido(conteudo([pressao(), pressao({ tipo: 'fato', fonteIdx: [0] }), pressao({ tipo: 'fato' })])), null);
  assert.match(setorInvalido(conteudo(['custo de frete'])), /pressoes\[0\] must be an object with texto filled/); // the old string form is refused in new output
  assert.match(setorInvalido(conteudo([pressao({ texto: '  ' })])), /pressoes\[0\] must be an object with texto filled/);
  assert.match(setorInvalido(conteudo([pressao(), pressao({ tipo: 'nao_encontrado' })])), /pressoes\[1\]\.tipo must be fato or inferencia/);
  assert.match(setorInvalido(conteudo([pressao({ tipo: undefined })])), /pressoes\[0\]\.tipo/);
  const semLista = conteudo(); semLista.pressoes = null;
  assert.match(setorInvalido(semLista), /pressoes must be a list/);
  assert.equal(pressoesInvalidas(conteudo([pressao()])), null);
});

test('group 15 runs after the chain groups: a chain refusal is reported first', () => {
  const c = conteudo(['velho']); c.setor.cadeiaDeValor.elos.pop();
  assert.match(setorInvalido(c, LIMITES_CADEIA_PADRAO), /mandatory elo/);
});

const fontes = [{ url: 'https://a.example/', titulo: 'a', tipo: 'busca', consultadoEm: '2026-11-20T00:00:00Z' }];
const env = (c, afirmacoes = [{ texto: 't', tipo: 'fato', fonteIdx: [0] }]) => ({ conteudo: c, fontes, afirmacoes, confianca: { grau: 'alta', motivo: 'm' } });

test('fill rule: a fato pressure without source lowers the confidence with "campos sem fonte", once; no refusal', () => {
  const r = normalizaEnvelope(env(conteudo([pressao({ tipo: 'fato' })])), new Set([chaveUrl(fontes[0].url)]), '2026-11-20T12:00:00Z');
  assert.equal(r.confianca.grau, 'baixa');
  assert.equal(r.confianca.motivo.match(/campos sem fonte/g).length, 1);
  const ok = normalizaEnvelope(env(conteudo([pressao({ tipo: 'fato', fonteIdx: [0] }), pressao()])), new Set([chaveUrl(fontes[0].url)]), '2026-11-20T12:00:00Z');
  assert.equal(ok.confianca.grau, 'alta');
  // the general rule already fired: the pressure does not add a second "campos sem fonte"
  const ambos = normalizaEnvelope(env(conteudo([pressao({ tipo: 'fato' })]), []), new Set(), '2026-11-20T12:00:00Z');
  assert.equal(ambos.confianca.motivo.match(/campos sem fonte/g).length, 1);
  assert.equal(pressaoFatoSemFonte(conteudo(['texto antigo'])), false);
});

test('tolerant reading: strings of a collection before v0.43 read as inferencia without source; objects unchanged; stored document not mutated', () => {
  assert.deepEqual(pressoesLidas(['a', pressao({ texto: 'b', tipo: 'fato', fonteIdx: [1] })]), [
    { texto: 'a', tipo: 'inferencia', fonteIdx: [] }, { texto: 'b', tipo: 'fato', fonteIdx: [1] },
  ]);
  assert.equal(pressoesLidas(null), null);
  const antigo = conteudo(['custo de frete', 'sazonalidade']); const copia = JSON.stringify(antigo);
  const col = coletaDe({ setor: { status: 'concluida', conteudo: antigo, afirmacoes: [], fontes: [] } });
  assert.deepEqual(col.setor.conteudo.pressoes, [{ texto: 'custo de frete', tipo: 'inferencia', fonteIdx: [] }, { texto: 'sazonalidade', tipo: 'inferencia', fonteIdx: [] }]);
  assert.equal(JSON.stringify(antigo), copia);
  const novo = conteudo([pressao()]);
  assert.equal(setorLido(novo).pressoes, novo.pressoes);
  assert.equal(setorLido(null), null);
  assert.deepEqual(setorLido({ setor: { cadeiaDeValor: 'texto' }, pressoes: ['x'] }).pressoes, [{ texto: 'x', tipo: 'inferencia', fonteIdx: [] }]); // any chain format
});

test('setor texts (v0.43): instruction asks tipo and source per pressure; schema has pressoes as objects', () => {
  assert.ok(INSTRUCOES.setor.includes('pressões típicas, cada uma com `tipo` (`fato` ou `inferencia`) e a fonte quando houver (v0.43); casos de uso'));
  assert.ok(ESQUEMAS.setor.includes('"pressoes": [{ "texto": "string", "tipo": "fato | inferencia", "fonteIdx": [0] }],'));
  assert.doesNotMatch(ESQUEMAS.setor, /"pressoes": \["string"\]/);
});

test('the collection call refuses the string pressures and gets one correction round', async () => {
  const corpos = []; const original = globalThis.fetch;
  const respostas = [conteudo(['velho']), conteudo([pressao()])];
  globalThis.fetch = async (_u, init) => {
    corpos.push(JSON.parse(init.body));
    const c = respostas[Math.min(corpos.length - 1, 1)];
    const text = JSON.stringify({ conteudo: c, fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: 'x' } });
    return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await chamaColeta({ chave: 'k', modelo: 'm', esforco: 'low', metodo: [], usuario: 'u', maxBuscas: 4, maxLeituras: 2, valida: (j) => formatoInvalido(j, CHAVES.setor) ?? setorInvalido(j.conteudo) });
    assert.equal(corpos.length, 2);
    assert.match(corpos[1].messages.at(-1).content, /pressoes\[0\] must be an object/);
    assert.equal(r.uso.partes.length, 2);
  } finally { globalThis.fetch = original; }
});

// --- E4: ligadaA ------------------------------------------------------------------------------------------------

test('preparar_conversa instruction (v0.43) classifies each question; the schema requires ligadaA in three values', () => {
  assert.ok(INSTRUCAO_CONVERSA.includes('Classifique cada pergunta em `ligadaA` (v0.43): `pessoa` quando ela trata de cargo, função, quem decide ou quem participa; `divergencia_de_fonte` quando nasce de duas fontes que se contradizem; `negocio` nos demais casos (empresa, processo, tecnologia, pedido, mercado). Pergunta que reúna duas classes recebe a mais restritiva, na ordem `pessoa`, `divergencia_de_fonte`, `negocio`. Materiais:'));
  const p = ESQUEMA_CONVERSA.properties.perguntas.items;
  assert.deepEqual(p.properties.ligadaA.enum, ['pessoa', 'divergencia_de_fonte', 'negocio']);
  assert.ok(p.required.includes('ligadaA'));
  assert.deepEqual([...LIGADA_A], ['pessoa', 'divergencia_de_fonte', 'negocio']);
});

const conversaCom = (ligadaA) => ({ ...simulaConversa('Ana'), perguntas: [{ pergunta: 'p', lacunaOuHipotese: 'l', origem: 'o', ...(ligadaA === undefined ? {} : { ligadaA }) }] });

test('validaConversa: preparar_conversa requires a valid ligadaA; the tolerant form accepts it absent but not invalid', () => {
  for (const v of LIGADA_A) assert.equal(validaConversa(conversaCom(v)).perguntas[0].ligadaA, v);
  assert.throws(() => validaConversa(conversaCom(undefined)), /preparar_conversa/);
  assert.throws(() => validaConversa(conversaCom('Pessoa')), /preparar_conversa/);
  assert.equal(validaConversa(conversaCom(undefined), false).perguntas[0].ligadaA, undefined);
  assert.throws(() => validaConversa(conversaCom('outro'), false), /preparar_conversa/);
  assert.equal(simulaConversa('Ana').perguntas.every((p) => LIGADA_A.includes(p.ligadaA)), true); // emulator stand-in
});

test('validaCorrecao accepts questions without ligadaA (base version before v0.43) and keeps the ones it has', () => {
  const m = simulaMontar(false);
  const base = { ...m, conversa: { perguntas: conversaCom(undefined).perguntas, materiais: [], pontosDeAtencaoParaOConsultor: [] }, rascunhoResposta: { assunto: 'a', corpo: 'Olá, Ana,' }, tratamentos: [] };
  assert.equal(validaCorrecao(base, 0).conversa.perguntas[0].ligadaA, undefined);
  const com = { ...base, conversa: { ...base.conversa, perguntas: conversaCom('pessoa').perguntas } };
  assert.equal(validaCorrecao(com, 0).conversa.perguntas[0].ligadaA, 'pessoa');
  const ruim = { ...base, conversa: { ...base.conversa, perguntas: conversaCom('x').perguntas } };
  assert.throws(() => validaCorrecao(ruim, 0));
});
