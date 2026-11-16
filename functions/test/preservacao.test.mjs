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

import { preservaBlocos } from '../lib/coleta/preservacao.js';

const anteriorCompleto = { ...antigo, insumosCodigo: { siteLido: true, apolloEncontrado: true, apolloFuncionarios: 50, instagramDoSite: 'acme', cnpjsNoSite: [], paginaCnpj: null } };

test('preservaBlocos: failed Apollo and failed Instagram of the same profile carry both, with the two Apollo facts', () => {
  const r = preservaBlocos(novo, anteriorCompleto, {
    apollo: { resultado: 'falha', motivo: 'resposta HTTP 503' },
    instagram: { resultado: 'nao_consultado', motivo: 'teto de chamadas da execução atingido', perfil: '@Acme' },
  });
  assert.deepEqual(r.blocos, ['apollo', 'instagram']);
  assert.equal(r.falha, 'Apollo: resposta HTTP 503; Instagram: teto de chamadas da execução atingido');
  assert.equal(r.desde, '2026-11-10T10:01:00.000Z');
  assert.deepEqual(r.insumosApollo, { apolloEncontrado: true, apolloFuncionarios: 50 });
  assert.equal(r.parte.fontes.length, 3);
  assert.deepEqual(r.parte.afirmacoes.map((a) => a.fonteIdx), [[0], [1], [2]]);
});

test('preservaBlocos: "não encontrado" and success never preserve', () => {
  assert.equal(preservaBlocos(novo, anteriorCompleto, { apollo: { resultado: 'nao_encontrado', motivo: 'x' }, instagram: { resultado: 'encontrado', motivo: 'x', perfil: 'acme' } }), null);
});

test('preservaBlocos: Instagram of another profile, or with no profile now, is not carried', () => {
  assert.equal(preservaBlocos(novo, anteriorCompleto, { instagram: { resultado: 'falha', motivo: 'x', perfil: 'outra.conta' } }), null);
  assert.equal(preservaBlocos(novo, anteriorCompleto, { instagram: { resultado: 'falha', motivo: 'x', perfil: null } }), null);
});

test('preservaBlocos: nothing to carry when the previous run had no data for the block', () => {
  const sem = { conteudo: { apollo: 'não consultado', instagram: 'sem link' }, fontes: [], afirmacoes: [] };
  assert.equal(preservaBlocos(novo, sem, { apollo: { resultado: 'falha', motivo: 'x' }, instagram: { resultado: 'falha', motivo: 'x', perfil: 'acme' } }), null);
  assert.equal(preservaBlocos(novo, null, { apollo: { resultado: 'falha', motivo: 'x' } }), null);
});

test('preservaBlocos: only the failed block is carried', () => {
  const r = preservaBlocos(novo, anteriorCompleto, { apollo: { resultado: 'encontrado', motivo: 'x' }, instagram: { resultado: 'falha', motivo: 'resposta HTTP 429', perfil: 'acme' } });
  assert.deepEqual(r.blocos, ['instagram']);
  assert.equal(r.insumosApollo, undefined);
  assert.equal(r.parte.conteudo.apollo, 'não consultado');
});

// --- roda(): whole-stage preservation and clean success, with a fake document (no network, no model) ---
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { roda } from '../lib/coleta/motor.js';

function contexto(anterior, completo = false) {
  const escritas = [];
  const doc = { update: async (d) => { escritas.push(d); } };
  const ref = { collection: () => ({ doc: () => doc, add: async (e) => { escritas.push({ evento: e.detalhe }); } }) };
  const c = {
    id: 'x', ref, p: { modelos: {}, fontes: {} }, ficha: { empresa: 'A' }, chaves: {}, aRodar: new Set(['empresa_noticias']),
    buscasRestantes: 5, chamadas: {}, conteudos: {}, codigo: {}, precos: null, totais: { tokensEntrada: 0, tokensSaida: 0, buscas: 0, usd: 0 }, anterior,
    ...(completo ? { contexto: { rotulo: 'qualificacao', valor: {} }, sinais: {}, email: 'a@b.com' } : {}),
  };
  return { c, escritas };
}
const ant = (extra = {}) => ({ status: 'concluida', conteudo: { a: 1 }, fontes: [{ url: 'u', titulo: 't', tipo: 'busca', consultadoEm: '2026-11-01T00:00:00.000Z' }], afirmacoes: [{ texto: 'x', tipo: 'fato', fonteIdx: [0] }], confianca: { grau: 'alta', motivo: 'm' }, concluidoEm: Timestamp.fromDate(new Date('2026-11-01T00:00:00Z')), ...extra });

test('roda: a stage that fails on a re-run keeps the previous content, status falhou, preservado "etapa"', async () => {
  delete process.env.FUNCTIONS_EMULATOR; // the stage fails because the context is deliberately incomplete (no model, no network)
  const { c, escritas } = contexto({ empresa_noticias: ant() });
  await roda(c, 'empresa_noticias');
  const f = escritas.find((e) => e.status === 'falhou');
  assert.deepEqual(f.conteudo, { a: 1 });
  assert.equal(f.confianca.grau, 'alta');
  assert.deepEqual(f.preservado.blocos, ['etapa']);
  assert.equal(f.preservado.desde.toDate().toISOString(), '2026-11-01T00:00:00.000Z');
  assert.ok(f.preservado.falha.length > 0);
  assert.deepEqual(c.conteudos.empresa_noticias, { a: 1 }); // downstream stages still read it
  assert.deepEqual(escritas.at(-1).evento.preservado, ['etapa']);
});

test('roda: second failure keeps the original desde and updates falhouEm', async () => {
  delete process.env.FUNCTIONS_EMULATOR;
  const desde = Timestamp.fromDate(new Date('2026-11-01T00:00:00Z'));
  const { c, escritas } = contexto({ empresa_noticias: ant({ status: 'falhou', preservado: { blocos: ['etapa'], desde, falhouEm: Timestamp.fromDate(new Date('2026-11-05T00:00:00Z')), falha: 'antiga' } }) });
  await roda(c, 'empresa_noticias');
  const f = escritas.find((e) => e.status === 'falhou');
  assert.equal(f.preservado.desde.toDate().toISOString(), '2026-11-01T00:00:00.000Z');
  assert.ok(f.preservado.falhouEm.toMillis() > Timestamp.fromDate(new Date('2026-11-05T00:00:00Z')).toMillis());
  assert.notEqual(f.preservado.falha, 'antiga');
});

test('roda: a stage with no usable previous content that fails is emptied as before', async () => {
  delete process.env.FUNCTIONS_EMULATOR;
  const { c, escritas } = contexto(undefined);
  await roda(c, 'empresa_noticias');
  const f = escritas.find((e) => e.status === 'falhou');
  assert.deepEqual(f.conteudo, {});
  assert.equal(f.preservado, undefined);
});

test('roda: a clean success deletes preservado', async () => {
  process.env.FUNCTIONS_EMULATOR = 'true'; // simulated stage: succeeds without a model
  try {
    const { c, escritas } = contexto({ empresa_noticias: ant() }, true);
    await roda(c, 'empresa_noticias');
    const f = escritas.find((e) => e.status === 'concluida');
    assert.equal(f.preservado instanceof FieldValue ? 'delete' : 'other', 'delete');
  } finally {
    delete process.env.FUNCTIONS_EMULATOR;
  }
});

import { anteriorDe } from '../lib/coleta/preservacao.js';
import { deveColetar } from '../lib/coletar.js';

test('anteriorDe: usable previous data is read from the content, whatever the status the claim left', () => {
  const doc = { conteudo: { a: 1 }, fontes: [], afirmacoes: [], confianca: { grau: 'alta', motivo: 'm' }, insumosCodigo: { x: 1 } };
  for (const status of ['concluida', 'pendente', 'executando']) assert.equal(anteriorDe({ ...doc, status }).conteudo.a, 1, status);
  assert.equal(anteriorDe({ ...doc, status: 'falhou', preservado: { blocos: ['etapa'] } }).conteudo.a, 1);
  assert.equal(anteriorDe({ ...doc, status: 'falhou' }), null);
  assert.equal(anteriorDe({ status: 'falhou', conteudo: {} }), null);
  assert.equal(anteriorDe({ status: 'pendente' }), null);
  assert.equal(anteriorDe(undefined), null);
  assert.deepEqual(anteriorDe({ ...doc, status: 'concluida' }).insumosCodigo, { x: 1 });
});

test('deveColetar: the move to coletando, or erro going from filled to null while it stays coletando', () => {
  assert.equal(deveColetar({ estado: 'coletada' }, { estado: 'coletando' }), true);
  assert.equal(deveColetar(undefined, { estado: 'coletando' }), true);
  assert.equal(deveColetar({ estado: 'coletando', erro: { etapa: 'x' } }, { estado: 'coletando', erro: null }), true);
  assert.equal(deveColetar({ estado: 'coletando', erro: null }, { estado: 'coletando', erro: null }), false);
  assert.equal(deveColetar({ estado: 'coletando', erro: null }, { estado: 'coletando', erro: { etapa: 'x' } }), false);
  assert.equal(deveColetar({ estado: 'coletando' }, { estado: 'coletada' }), false);
  assert.equal(deveColetar({ estado: 'coletando', erro: { etapa: 'x' } }, { estado: 'coletada', erro: null }), false);
});
