// acaoAdmin against the Firebase emulators (functions + firestore + auth), run by `npm run emulador` after
// emulador.test.mjs, one file at a time (--test-concurrency=1) because some tests change config/pipeline.
// Real callable calls with an ID token from the Auth emulator; fichas are written directly with the admin SDK.
// A ficha sent to coletando triggers the real coletar on a ficha without a pipeline history; the tests only
// look at what the action wrote and delete the fichas at the end.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { executaAcao, ErroAcao } from '../lib/acaoAdmin.js';
import { diaDeSaoPaulo } from '../lib/graduar.js';

const PROJETO = 'gmdb-qualidade';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const FUNCAO = `http://127.0.0.1:5001/${PROJETO}/southamerica-east1/acaoAdmin`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key';
const DIA_MS = 24 * 60 * 60 * 1000;

const app = initializeApp({ projectId: PROJETO }, 'acao-admin');
const db = getFirestore(app);
const ts = (iso) => Timestamp.fromDate(new Date(iso));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// A user of the Auth emulator; its usuarios/{uid} document gives the papel (none for "sem documento").
async function criaUsuario(papel) {
  const email = `${randomUUID()}@teste.local`;
  const r = await (await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: randomUUID(), returnSecureToken: true }) })).json();
  if (papel) await db.doc(`usuarios/${r.localId}`).set({ papel, nome: 'Teste', criadoEm: Timestamp.now(), criadoPor: 'teste' });
  return { token: r.idToken, uid: r.localId };
}

// Calls the callable; returns {status, resultado} on success and {status, erro} on error.
async function chama(token, data) {
  const r = await fetch(FUNCAO, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }) });
  const corpo = await r.json();
  return { status: r.status, resultado: corpo.result, erro: corpo.error };
}

const criadas = [];
// A ficha with the minimum the actions read; `original` is only there so a triggered coletar has something to read.
async function criaFicha(campos) {
  const id = `acao-${randomUUID().slice(0, 8)}`;
  criadas.push(id);
  const agora = ts('2026-11-16T12:00:00Z');
  await db.doc(`fichas/${id}`).set({
    original: { nome: 'Teste', empresa: 'ACME', cargo: 'ceo', email: 'teste@acme.com.br', site: null, mensagem: null, lang: 'pt-BR' },
    recebidaEm: agora, estadoEm: agora, expurgoEm: ts('2026-12-16T12:00:00Z'), analiseAtual: 'v1', ...campos,
  });
  return id;
}
const eventos = async (id) => (await db.collection(`fichas/${id}/eventos`).get()).docs.map((d) => d.data());
const tiposDe = async (id) => (await eventos(id)).map((e) => e.tipo);

let admin, leitor, semDoc;
before(async () => {
  admin = await criaUsuario('admin');
  leitor = await criaUsuario('leitor');
  semDoc = await criaUsuario(null);
});
after(async () => {
  await espera(1500); // let a triggered coletar settle before the fichas go
  for (const id of criadas) await db.recursiveDelete(db.doc(`fichas/${id}`)).catch(() => {});
  await db.doc(`controle/analises-${diaDeSaoPaulo(new Date())}`).delete().catch(() => {});
  await db.doc('config/pipeline').set({ maxAnalisesPorDia: 100 }, { merge: true });
  await deleteApp(app);
});

const codigo = (r) => r.erro?.details?.codigo;

test('nao_autenticado: no token', async () => {
  const id = await criaFicha({ estado: 'analise_pronta' });
  const r = await chama(null, { fichaId: id, acao: 'aprovar' });
  assert.equal(r.status, 401);
  assert.equal(codigo(r), 'nao_autenticado');
});

test('sem_permissao: a leitor and a user without a usuarios document', async () => {
  const id = await criaFicha({ estado: 'analise_pronta' });
  for (const u of [leitor, semDoc]) {
    const r = await chama(u.token, { fichaId: id, acao: 'aprovar' });
    assert.equal(r.status, 403);
    assert.equal(codigo(r), 'sem_permissao');
  }
  assert.equal((await db.doc(`fichas/${id}`).get()).data().estado, 'analise_pronta');
});

test('ficha_inexistente', async () => {
  const r = await chama(admin.token, { fichaId: 'nao-existe', acao: 'aprovar' });
  assert.equal(r.status, 404);
  assert.equal(codigo(r), 'ficha_inexistente');
});

test('parametro_invalido: unknown action, missing fichaId, arquivar without expurgoImediato', async () => {
  const id = await criaFicha({ estado: 'analise_pronta' });
  let r = await chama(admin.token, { fichaId: id, acao: 'voar' });
  assert.equal(codigo(r), 'parametro_invalido');
  assert.equal(r.erro.details.campo, 'acao');
  r = await chama(admin.token, { acao: 'aprovar' });
  assert.equal(r.erro.details.campo, 'fichaId');
  r = await chama(admin.token, { fichaId: id, acao: 'arquivar', parametros: {} });
  assert.equal(r.status, 400);
  assert.equal(r.erro.details.campo, 'expurgoImediato');
});

test('aprovar: from analise_pronta and from analise_com_pendencias; the event is recorded and a repeat adds nothing', async () => {
  for (const estado of ['analise_pronta', 'analise_com_pendencias']) {
    const id = await criaFicha({ estado });
    const r = await chama(admin.token, { fichaId: id, acao: 'aprovar' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.resultado, { ok: true, estado: 'aprovada', analiseAtual: 'v1' });
    const f = (await db.doc(`fichas/${id}`).get()).data();
    assert.equal(f.estado, 'aprovada');
    assert.ok(f.estadoEm.toMillis() > ts('2026-11-16T12:00:00Z').toMillis());
    assert.deepEqual(await tiposDe(id), ['aprovada']);
    const ev = (await eventos(id))[0];
    assert.deepEqual(ev.ator, { tipo: 'humano', id: admin.uid });

    // Repeating: invalid in the new state, with the current state, and no second event.
    const rep = await chama(admin.token, { fichaId: id, acao: 'aprovar' });
    assert.equal(rep.status, 400);
    assert.equal(codigo(rep), 'acao_invalida_no_estado');
    assert.equal(rep.erro.details.estadoAtual, 'aprovada');
    assert.equal((await eventos(id)).length, 1);
  }
});

test('acao_invalida_no_estado: aprovar in qualificada; the state is not touched', async () => {
  const id = await criaFicha({ estado: 'qualificada' });
  const r = await chama(admin.token, { fichaId: id, acao: 'aprovar' });
  assert.equal(codigo(r), 'acao_invalida_no_estado');
  assert.equal(r.erro.details.estadoAtual, 'qualificada');
  assert.equal((await eventos(id)).length, 0);
});

test('respostaEnviada: aprovada to respondida, respondidaEm set, expurgoEm = now + 90 days, event recorded', async () => {
  const id = await criaFicha({ estado: 'aprovada' });
  const antes = Date.now();
  const r = await chama(admin.token, { fichaId: id, acao: 'respostaEnviada' });
  assert.deepEqual(r.resultado, { ok: true, estado: 'respondida', analiseAtual: 'v1' });
  const f = (await db.doc(`fichas/${id}`).get()).data();
  assert.equal(f.estado, 'respondida');
  assert.ok(f.respondidaEm.toMillis() >= antes - 1000);
  assert.ok(Math.abs(f.expurgoEm.toMillis() - (f.respondidaEm.toMillis() + 90 * DIA_MS)) < 1000);
  assert.deepEqual(await tiposDe(id), ['resposta_enviada']);
  const rep = await chama(admin.token, { fichaId: id, acao: 'respostaEnviada' });
  assert.equal(codigo(rep), 'acao_invalida_no_estado');
  assert.equal((await eventos(id)).length, 1);
});

test('ficha_em_processamento: a long state without erro refuses every action; with erro only reexecutar and arquivar are valid', async () => {
  for (const estado of ['coleta_minima', 'coletando', 'sintetizando']) {
    const id = await criaFicha({ estado, erro: null });
    for (const acao of ['aprovar', 'arquivar']) {
      const r = await chama(admin.token, { fichaId: id, acao, parametros: { expurgoImediato: false } });
      assert.equal(r.status, 400);
      assert.equal(codigo(r), 'ficha_em_processamento');
      assert.equal(r.erro.details.estadoAtual, estado);
    }
    assert.equal((await db.doc(`fichas/${id}`).get()).data().estado, estado);
  }
  const comErro = await criaFicha({ estado: 'coletando', erro: { etapa: 'interrupcao:coletando', mensagem: 'x', em: Timestamp.now() } });
  const nao = await chama(admin.token, { fichaId: comErro, acao: 'aprovar' });
  assert.equal(codigo(nao), 'acao_invalida_no_estado');
  const sim = await chama(admin.token, { fichaId: comErro, acao: 'arquivar', parametros: { expurgoImediato: false } });
  assert.equal(sim.resultado.estado, 'arquivada');
});

test('mandarParaAnalise from resposta_breve: coletando, destinoAlterado, 90-day retention, counted in the day and not stopped by the ceiling', async () => {
  const dia = diaDeSaoPaulo(new Date());
  await db.doc(`controle/analises-${dia}`).delete();
  await db.doc('config/pipeline').set({ maxAnalisesPorDia: 0 }, { merge: true }); // a ceiling of 0 cuts every automatic one
  const id = await criaFicha({ estado: 'resposta_breve', lead: { destino: 'encerrar', destinoAlterado: false }, expurgoEm: ts('2026-12-01T12:00:00Z') });
  const r = await chama(admin.token, { fichaId: id, acao: 'mandarParaAnalise' });
  assert.equal(r.status, 200);
  assert.equal(r.resultado.estado, 'coletando');
  const f = (await db.doc(`fichas/${id}`).get()).data();
  assert.equal(f.lead.destinoAlterado, true);
  assert.equal(f.expurgoEm.toMillis(), ts('2026-11-16T12:00:00Z').toMillis() + 90 * DIA_MS);
  assert.ok((await tiposDe(id)).includes('destino_alterado'));
  assert.equal((await db.doc(`controle/analises-${dia}`).get()).data().n, 1);
});

test('mandarParaAnalise from a held qualificada: retencao_liberada manual, retencao null, destinoAlterado unchanged, counted in the day', async () => {
  const dia = diaDeSaoPaulo(new Date());
  await db.doc(`controle/analises-${dia}`).delete();
  await db.doc('config/pipeline').set({ maxAnalisesPorDia: 0 }, { merge: true });
  for (const motivo of ['teto_diario', 'auto_desligada']) {
    const id = await criaFicha({ estado: 'qualificada', lead: { destino: 'convidar', destinoAlterado: false }, retencao: { motivo, desde: Timestamp.now(), liberacaoPrevista: null } });
    const r = await chama(admin.token, { fichaId: id, acao: 'mandarParaAnalise' });
    assert.equal(r.resultado.estado, 'coletando');
    const f = (await db.doc(`fichas/${id}`).get()).data();
    assert.equal(f.retencao, null);
    assert.equal(f.lead.destinoAlterado, false);
    const ev = (await eventos(id)).find((e) => e.tipo === 'retencao_liberada');
    assert.deepEqual(ev.detalhe, { motivo, modo: 'manual' });
    assert.ok(!(await tiposDe(id)).includes('destino_alterado'));
  }
  assert.equal((await db.doc(`controle/analises-${dia}`).get()).data().n, 2);
});

test('mandarParaAnalise in an invalid state: qualificada without retencao and analise_pronta', async () => {
  for (const [estado, extra] of [['qualificada', {}], ['analise_pronta', {}]]) {
    const id = await criaFicha({ estado, ...extra });
    const r = await chama(admin.token, { fichaId: id, acao: 'mandarParaAnalise' });
    assert.equal(codigo(r), 'acao_invalida_no_estado');
    assert.equal(r.erro.details.estadoAtual, estado);
  }
});

test('arquivar without expurgoImediato: arquivada, expurgoEm kept, event with expurgoImediato false', async () => {
  const id = await criaFicha({ estado: 'respondida' });
  const antes = (await db.doc(`fichas/${id}`).get()).data().expurgoEm.toMillis();
  const r = await chama(admin.token, { fichaId: id, acao: 'arquivar', parametros: { expurgoImediato: false } });
  assert.deepEqual(r.resultado, { ok: true, estado: 'arquivada', analiseAtual: 'v1' });
  const f = (await db.doc(`fichas/${id}`).get()).data();
  assert.equal(f.estado, 'arquivada');
  assert.equal(f.expurgoEm.toMillis(), antes);
  assert.deepEqual((await eventos(id))[0].detalhe, { expurgoImediato: false });
  const rep = await chama(admin.token, { fichaId: id, acao: 'arquivar', parametros: { expurgoImediato: false } });
  assert.equal(codigo(rep), 'acao_invalida_no_estado');
  assert.equal((await eventos(id)).length, 1);
});

test('arquivar with expurgoImediato: the ficha and every subcollection are gone and the answer is "apagada"', async () => {
  const id = await criaFicha({ estado: 'descartada' });
  await db.doc(`fichas/${id}/coleta/empresa_digital`).set({ etapa: 'empresa_digital', status: 'concluida' });
  await db.doc(`fichas/${id}/coleta/empresa_registro`).set({ etapa: 'empresa_registro', status: 'concluida' });
  await db.doc(`fichas/${id}/eventos/e1`).set({ tipo: 'recebida', em: Timestamp.now() });
  const r = await chama(admin.token, { fichaId: id, acao: 'arquivar', parametros: { expurgoImediato: true } });
  assert.deepEqual(r.resultado, { ok: true, estado: 'apagada' });
  assert.equal((await db.doc(`fichas/${id}`).get()).exists, false);
  for (const sub of ['coleta', 'eventos']) assert.equal((await db.collection(`fichas/${id}/${sub}`).get()).size, 0);
  const rep = await chama(admin.token, { fichaId: id, acao: 'arquivar', parametros: { expurgoImediato: true } });
  assert.equal(codigo(rep), 'ficha_inexistente');
});

test('actions of phase 5b are validated against the state but not available yet: interno', async () => {
  const id = await criaFicha({ estado: 'analise_pronta' });
  const r = await chama(admin.token, { fichaId: id, acao: 'editar', parametros: { secao: 's1', corpo: 'x', baseadaEm: 'v1' } });
  assert.equal(r.status, 500);
  assert.equal(codigo(r), 'interno');
  assert.ok(!/editar|fichas/.test(r.erro.message));
  const inv = await chama(admin.token, { fichaId: id, acao: 'respostaEnviada' });
  assert.equal(codigo(inv), 'acao_invalida_no_estado');
});

test('conflito: the ficha changes between the read and the transaction (in-process, with the test hook)', async () => {
  const id = await criaFicha({ estado: 'analise_pronta' });
  await assert.rejects(
    executaAcao(db, { prazoGuardaDias: 90, maxAnalisesPorDia: null }, { uid: admin.uid, fichaId: id, acao: 'aprovar', parametros: {} }, {
      antesDaTransacao: () => db.doc(`fichas/${id}`).update({ estado: 'analise_com_pendencias', estadoEm: Timestamp.now() }),
    }),
    (e) => e instanceof ErroAcao && e.codigo === 'conflito',
  );
  assert.equal((await db.doc(`fichas/${id}`).get()).data().estado, 'analise_com_pendencias');
  assert.equal((await eventos(id)).length, 0);
});
