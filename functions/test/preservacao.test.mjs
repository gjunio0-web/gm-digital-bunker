// Preservation of the previous data on a re-run: pure functions (spec 03, 7.3). No provider or model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apolloTemDados, ehFonteDoBloco, etapaUsavel, fundeBloco, identificadorInstagram, instagramTemDados,
  insumosDoApollo, mesmoPerfil, montaPreservado, motivoDaFalha, resultadoDe,
} from '../lib/coleta/preservacao.js';

test('resultadoDe: failure is no response or anything that is neither 2xx nor 404', () => {
  for (const s of [0, 400, 401, 402, 403, 405, 408, 410, 413, 422, 429, 500, 503, 301]) assert.equal(resultadoDe(s, null), 'falha', String(s));
  assert.equal(resultadoDe(404, null), 'nao_encontrado');
  assert.equal(resultadoDe(200, null), 'nao_encontrado');
  assert.equal(resultadoDe(204, null), 'nao_encontrado');
  assert.equal(resultadoDe(200, { perfil: 'x' }), 'encontrado');
  assert.equal(resultadoDe(Number.NaN, null), 'falha');
  assert.match(motivoDaFalha(0), /sem resposta/);
  assert.equal(motivoDaFalha(503), 'resposta HTTP 503');
});

test('Instagram identifier: normalized; same profile only when both known and equal', () => {
  assert.equal(identificadorInstagram('@Acme.Oficial'), 'acme.oficial');
  assert.equal(identificadorInstagram('https://www.instagram.com/Acme.Oficial/?hl=pt'), 'acme.oficial');
  assert.equal(identificadorInstagram('  '), null);
  assert.equal(identificadorInstagram(null), null);
  assert.equal(mesmoPerfil('acme', '@ACME'), true);
  assert.equal(mesmoPerfil('acme', 'acme2'), false);
  assert.equal(mesmoPerfil('acme', null), false);
  assert.equal(mesmoPerfil(null, null), false);
});

test('blocks worth preserving', () => {
  assert.equal(instagramTemDados({ perfil: 'a', seguidores: 10 }), true);
  assert.equal(instagramTemDados('perfil linkado no site: a (sem dados do Apify)'), false);
  assert.equal(instagramTemDados({ perfil: 'a', seguidores: null }), false);
  assert.equal(apolloTemDados({ funcionariosEstimados: { maximo: 50 } }), true);
  assert.equal(apolloTemDados('não consultado'), false);
  assert.equal(apolloTemDados(null), false);
});

const antigo = {
  conteudo: { apollo: { setorFornecedor: 'Software', funcionariosEstimados: { maximo: 50 } }, instagram: { perfil: 'acme', seguidores: 10 }, presencaGeografica: 'SP' },
  fontes: [
    { url: 'https://acme.com.br/', titulo: 'home', tipo: 'pagina', consultadoEm: '2026-11-10T10:00:00.000Z' },
    { url: 'https://api.apollo.io/api/v1/organizations/enrich?domain=acme.com.br', titulo: 'Apollo', tipo: 'api', consultadoEm: '2026-11-10T10:01:00.000Z' },
    { url: 'https://www.instagram.com/acme/', titulo: 'Instagram', tipo: 'api', consultadoEm: '2026-11-10T10:02:00.000Z' },
  ],
  afirmacoes: [
    { texto: 'Site institucional', tipo: 'fato', fonteIdx: [0] },
    { texto: 'Apollo: 50 funcionários', tipo: 'fato', fonteIdx: [1] },
    { texto: 'Instagram: 10 seguidores', tipo: 'fato', fonteIdx: [2, 0] },
  ],
};
const novo = {
  conteudo: { apollo: 'não consultado', instagram: 'sem link', presencaGeografica: 'RJ' },
  fontes: [{ url: 'https://acme.com.br/sobre', titulo: 'sobre', tipo: 'pagina', consultadoEm: '2026-11-16T10:00:00.000Z' }],
  afirmacoes: [{ texto: 'Página sobre', tipo: 'fato', fonteIdx: [0] }],
};

test('ehFonteDoBloco recognizes the Apollo and Instagram sources', () => {
  assert.equal(ehFonteDoBloco('apollo', antigo.fontes[1]), true);
  assert.equal(ehFonteDoBloco('apollo', antigo.fontes[2]), false);
  assert.equal(ehFonteDoBloco('instagram', antigo.fontes[2]), true);
  assert.equal(ehFonteDoBloco('instagram', antigo.fontes[0]), false);
});

test('fundeBloco (apollo): block replaces the new one; source appended with original date; statements reindexed', () => {
  const r = fundeBloco(novo, antigo, 'apollo');
  assert.deepEqual(r.parte.conteudo.apollo, antigo.conteudo.apollo);
  assert.equal(r.parte.conteudo.instagram, 'sem link'); // other blocks stay the new run's
  assert.equal(r.parte.conteudo.presencaGeografica, 'RJ');
  assert.equal(r.parte.fontes.length, 2);
  assert.equal(r.parte.fontes[1].consultadoEm, '2026-11-10T10:01:00.000Z');
  assert.deepEqual(r.parte.afirmacoes.map((a) => [a.texto, a.fonteIdx]), [['Página sobre', [0]], ['Apollo: 50 funcionários', [1]]]);
  assert.equal(r.desde, '2026-11-10T10:01:00.000Z');
  // inputs are not mutated
  assert.equal(novo.fontes.length, 1);
  assert.equal(novo.conteudo.apollo, 'não consultado');
});

test('fundeBloco (instagram): a statement with another source keeps only the carried index', () => {
  const r = fundeBloco(novo, antigo, 'instagram');
  assert.equal(r.parte.fontes.length, 2);
  assert.deepEqual(r.parte.afirmacoes.at(-1).fonteIdx, [1]);
  assert.equal(r.desde, '2026-11-10T10:02:00.000Z');
});

test('fundeBloco: nothing to carry returns null', () => {
  assert.equal(fundeBloco(novo, { conteudo: {}, fontes: [], afirmacoes: [] }, 'apollo'), null);
  assert.equal(fundeBloco(novo, { conteudo: { apollo: null }, fontes: [], afirmacoes: [] }, 'apollo'), null);
});

test('insumosDoApollo carries only the two Apollo facts', () => {
  const r = insumosDoApollo({ siteLido: true, apolloEncontrado: true, apolloFuncionarios: 50, instagramDoSite: 'x', cnpjsNoSite: ['1'], paginaCnpj: 'p' });
  assert.deepEqual(r, { apolloEncontrado: true, apolloFuncionarios: 50 });
  assert.deepEqual(insumosDoApollo(null), { apolloEncontrado: undefined, apolloFuncionarios: undefined });
});

test('montaPreservado: second failure keeps the original desde, updates falhouEm, unites blocks', () => {
  const a = montaPreservado(['apollo'], 'd1', 'f1', 'resposta HTTP 503');
  assert.deepEqual(a, { blocos: ['apollo'], desde: 'd1', falhouEm: 'f1', falha: 'resposta HTTP 503' });
  const b = montaPreservado(['instagram'], 'd2', 'f2', 'resposta HTTP 429', a);
  assert.deepEqual(b, { blocos: ['apollo', 'instagram'], desde: 'd1', falhouEm: 'f2', falha: 'resposta HTTP 429' });
  const c = montaPreservado(['etapa'], 'd3', 'f3', 'x', null);
  assert.equal(c.desde, 'd3');
});

test('etapaUsavel: concluida, or falhou with whole-stage preservation; never pendente/executando', () => {
  assert.equal(etapaUsavel({ status: 'concluida' }), true);
  assert.equal(etapaUsavel({ status: 'concluida', preservado: { blocos: ['apollo'] } }), true);
  assert.equal(etapaUsavel({ status: 'falhou', preservado: { blocos: ['etapa'] } }), true);
  assert.equal(etapaUsavel({ status: 'falhou', preservado: { blocos: ['apollo'] } }), false);
  assert.equal(etapaUsavel({ status: 'falhou' }), false);
  assert.equal(etapaUsavel({ status: 'pendente', preservado: { blocos: ['etapa'] } }), false);
  assert.equal(etapaUsavel({ status: 'executando', conteudo: { a: 1 } }), false);
  assert.equal(etapaUsavel(undefined), false);
});
