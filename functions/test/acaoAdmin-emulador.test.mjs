// acaoAdmin against the Firebase emulators (functions + firestore + auth), run by `npm run emulador` after
// emulador.test.mjs, one file at a time (--test-concurrency=1) because some tests change config/pipeline.
// Real callable calls with an ID token from the Auth emulator; fichas are written directly with the admin SDK.
// A ficha sent to coletando triggers the real coletar on a ficha without a pipeline history; the tests only
// look at what the action wrote and delete the fichas at the end.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { executaAcao, ErroAcao } from '../lib/acaoAdmin.js';
import { diaDeSaoPaulo } from '../lib/graduar.js';
import { ARQUIVOS_METODO } from '../lib/metodoArquivos.js';

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

const ETAPAS_COLETA = ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado'];
const etapaDoc = (id, etapa, campos) => db.doc(`fichas/${id}/coleta/${etapa}`).set({ etapa, versaoMetodo: 'm1', tentativa: 1, ...campos });
const concluida = { status: 'concluida', conteudo: { a: 1 }, fontes: [], afirmacoes: [], confianca: { grau: 'alta', motivo: 'm' }, insumosCodigo: null };
const falhou = { status: 'falhou', conteudo: {}, fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: 'falha: x' } };
// What coletar reads when the ficha goes to coletando (the real coletar runs in the emulator, with simulated stages).
const camposDeColeta = { versaoMetodo: 'm1', normalizado: { email: 'teste@acme.com.br', site: null }, qualificacao: { dominioCorporativo: true, siteResolvido: null } };
async function ate(fn, ms = 40000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { const r = await fn(); if (r) return r; await espera(400); }
  return null;
}

test('reexecutar (coleta): from an analysed state the chosen stage is redone by coletar with its previous data kept, and the ficha leaves coletando', async () => {
  const id = await criaFichaAnalisada();
  await db.doc(`fichas/${id}`).update(camposDeColeta);
  for (const e of ETAPAS_COLETA) await etapaDoc(id, e, concluida);
  const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['empresa_noticias', 'setor'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.resultado, { ok: true, estado: 'coletando', analiseAtual: 'v1' });
  const reexec = (await eventos(id)).find((e) => e.tipo === 'reexecucao');
  assert.deepEqual(reexec.detalhe.alvos, ['empresa_noticias', 'setor']);
  // coletar picks it up: only the two stages are rerun (tentativa 2); the others stay as they were (tentativa 1).
  const refeita = await ate(async () => {
    const d = (await db.doc(`fichas/${id}/coleta/setor`).get()).data();
    return d.status === 'concluida' && d.tentativa === 2 ? d : null;
  });
  assert.ok(refeita, 'setor was redone by coletar');
  const noticias = (await db.doc(`fichas/${id}/coleta/empresa_noticias`).get()).data();
  assert.equal(noticias.tentativa, 2);
  for (const e of ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'mercado']) assert.equal((await db.doc(`fichas/${id}/coleta/${e}`).get()).data().tentativa, 1, e);
  const inicio = (await eventos(id)).find((e) => e.tipo === 'coleta_iniciada');
  assert.equal(inicio.detalhe.passagem, 'reexecucao');
  assert.deepEqual([...inicio.detalhe.etapas].sort(), ['empresa_noticias', 'setor']);
  const f = (await db.doc(`fichas/${id}`).get()).data();
  assert.ok(f.lead); // the triagem is not redone: the lead stays (the synthesis may regrade it)
  assert.ok(f.analiseAtual);
});

test('reexecutar (coleta): coletando with erro cleared by the action fires coletar again (the stage that failed is redone)', async () => {
  const id = await criaFicha({ estado: 'coletando', ...camposDeColeta, erro: { etapa: 'coletar', mensagem: 'x', em: ts('2026-11-16T12:30:00Z') } });
  for (const e of ETAPAS_COLETA) await etapaDoc(id, e, e === 'mercado' ? falhou : concluida);
  const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['mercado'] } });
  assert.deepEqual(r.resultado, { ok: true, estado: 'coletando', analiseAtual: 'v1' });
  const refeita = await ate(async () => {
    const d = (await db.doc(`fichas/${id}/coleta/mercado`).get()).data();
    return d.status === 'concluida' ? d : null;
  });
  assert.ok(refeita, 'mercado was redone by coletar although the ficha stayed in coletando');
  assert.equal(refeita.tentativa, 2);
});

test('reexecutar (coleta): coletada with erro (synthesis phase) takes only sintese; a finished stage is not offered in coletando with erro', async () => {
  const erro = { etapa: 'sintetizar', mensagem: 'x', em: ts('2026-11-16T12:30:00Z') };
  const coletada = await criaFicha({ estado: 'coletada', ...camposDeColeta, erro });
  for (const e of ETAPAS_COLETA) await etapaDoc(coletada, e, e === 'setor' ? falhou : concluida);
  const naColetada = await chama(admin.token, { fichaId: coletada, acao: 'reexecutar', parametros: { alvo: ['setor'] } });
  assert.equal(codigo(naColetada), 'parametro_invalido');
  assert.equal(naColetada.erro.details.campo, 'alvo');
  assert.equal((await db.doc(`fichas/${coletada}/coleta/setor`).get()).data().status, 'falhou');
  assert.deepEqual(await tiposDe(coletada), []);
  const coletando = await criaFicha({ estado: 'coletando', ...camposDeColeta, erro: { ...erro, etapa: 'coletar' } });
  for (const e of ETAPAS_COLETA) await etapaDoc(coletando, e, e === 'setor' ? falhou : concluida);
  const recusa = await chama(admin.token, { fichaId: coletando, acao: 'reexecutar', parametros: { alvo: ['empresa_digital'] } });
  assert.equal(codigo(recusa), 'parametro_invalido');
  assert.equal((await db.doc(`fichas/${coletando}/coleta/empresa_digital`).get()).data().status, 'concluida');
  assert.deepEqual(await tiposDe(coletando), []);
});

// qualificar reads the published method (config/metodo); this file may run on an emulator where none was published.
async function garanteMetodo() {
  if ((await db.doc('config/metodo').get()).get('versao')) return;
  const raiz = new URL('../../metodo/', import.meta.url);
  const arquivos = ARQUIVOS_METODO.map((nome) => ({ nome, conteudo: readFileSync(new URL(nome, raiz), 'utf8') }));
  const r = await fetch(`http://127.0.0.1:5001/${PROJETO}/southamerica-east1/publicarMetodo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versao: 'm1', arquivos }) });
  assert.equal(r.status, 200);
}

test('reexecutar (coleta_minima com erro): the pending minimal stage is redone by retomarColetaMinima, then qualificar and graduar run', async () => {
  await garanteMetodo();
  const id = await criaFicha({ estado: 'coleta_minima', ...camposDeColeta, erro: { etapa: 'coleta_minima', mensagem: 'x', em: ts('2026-11-16T12:30:00Z') } });
  await db.doc(`fichas/${id}`).update({ 'original.mensagem': 'Queremos sair das planilhas com apoio de um conselho.' });
  await etapaDoc(id, 'empresa_digital', concluida);
  await etapaDoc(id, 'empresa_registro', falhou);
  const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['empresa_registro'] } });
  assert.deepEqual(r.resultado, { ok: true, estado: 'coleta_minima', analiseAtual: 'v1' });
  const f = await ate(async () => {
    const d = (await db.doc(`fichas/${id}`).get()).data();
    return d.estado !== 'coleta_minima' || d.erro ? d : null;
  });
  assert.ok(f, 'the ficha left coleta_minima');
  assert.equal(f.erro ?? null, null);
  assert.ok(f.lead, 'graduar ran');
  const registro = (await db.doc(`fichas/${id}/coleta/empresa_registro`).get()).data();
  assert.equal(registro.status, 'concluida');
  assert.equal(registro.tentativa, 2);
  assert.equal((await db.doc(`fichas/${id}/coleta/empresa_digital`).get()).data().tentativa, 1); // not pending: untouched
  const tipos = await tiposDe(id);
  for (const t of ['reexecucao', 'coleta_minima', 'qualificada']) assert.ok(tipos.includes(t), t);
  const min = (await eventos(id)).find((e) => e.tipo === 'coleta_minima');
  assert.equal(min.detalhe.passagem, 'reexecucao');
});

test('reexecutar (coleta): refused with nothing written in coleta_minima with a non-minimal stage, in sintetizando and qualificada with erro, and with a missing stage document', async () => {
  const erro = (etapa) => ({ etapa, mensagem: 'x', em: ts('2026-11-16T12:30:00Z') });
  const casos = [
    [{ estado: 'coleta_minima', erro: erro('coleta_minima') }, ['setor']],
    [{ estado: 'sintetizando', erro: erro('sintetizar') }, ['empresa_digital']],
    [{ estado: 'qualificada', erro: erro('graduar') }, ['empresa_digital']],
  ];
  for (const [campos, alvo] of casos) {
    const id = await criaFicha(campos);
    for (const e of ETAPAS_COLETA) await etapaDoc(id, e, falhou);
    const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo } });
    assert.equal(codigo(r), 'parametro_invalido', campos.estado);
    assert.equal((await db.doc(`fichas/${id}/coleta/${alvo[0]}`).get()).data().status, 'falhou');
    assert.equal((await db.doc(`fichas/${id}`).get()).data().estado, campos.estado);
    assert.deepEqual(await tiposDe(id), []);
  }
  const semDoc = await criaFichaAnalisada();
  const r = await chama(admin.token, { fichaId: semDoc, acao: 'reexecutar', parametros: { alvo: ['setor'] } });
  assert.equal(codigo(r), 'parametro_invalido');
  assert.equal((await db.doc(`fichas/${semDoc}`).get()).data().estado, 'analise_pronta');
  const inv = await chama(admin.token, { fichaId: semDoc, acao: 'respostaEnviada' });
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

// --- portaDecidida and editar (phase 5b, first part) --------------------------------------------------------

const TITULOS = { s0: 'Cabeçalho', s1: 'Qualificação imediata', s2: 'A empresa', s3: 'Setor', s4: 'Potencial de mercado', s5: 'Pessoas', s6: 'Enquadramento', s7: 'Preparação da primeira conversa', s8: 'Fontes' };
const secoesV1 = () => Object.fromEntries(Object.entries(TITULOS).map(([k, t]) => [k, {
  titulo: t, corpo: k === 's0' ? '**Empresa:** ACME\n\n**Método:** versão m1 · **Modelo:** claude-sonnet-5-5' : `corpo original de ${k}`, vazia: false, motivoVazia: null,
}]));
// A ficha with a first analysis the way sintetizar leaves it, and a lead for s0.
async function criaFichaAnalisada(estado = 'analise_pronta') {
  const id = await criaFicha({
    estado, qualificacao: {}, versaoMetodo: 'm1',
    lead: { quadrante: 'priorizar', grau: 'A', pontos: 80, destino: 'convidar', acao: { prazoDiasUteis: 2, prazoEm: ts('2026-11-18T12:00:00Z') } },
  });
  await db.doc(`fichas/${id}/analise/v1`).set({
    autor: { tipo: 'ia', id: 'claude-sonnet-5-5', origem: 'sintese' }, baseadaEm: null, versaoMetodo: 'm1', secoes: secoesV1(),
    enquadramento: { escopo: 'aprovado', portaProvavel: 'conselho', riscos: [], detalhe: { x: 1 } }, resumoExecutivo: 'resumo', conversa: { perguntas: [], materiais: [], pontosDeAtencao: [] },
    rascunhoResposta: { assunto: 'a', corpo: 'b' }, verificacao: { status: 'pronta', pendencias: [], reparos: [], avisos: [], checklist: [] }, verificacaoIniciadaEm: Timestamp.now(),
    uso: { total: { usdEstimado: 1 } }, correcao: { pendencias: [], tratamentos: [], avisos: [] }, criadaEm: ts('2026-11-16T12:00:00Z'),
  });
  return id;
}

test('portaDecidida: sets the door with {de, para}, the same door again is ok without event, another one changes it', async () => {
  const id = await criaFichaAnalisada();
  const a = await chama(admin.token, { fichaId: id, acao: 'portaDecidida', parametros: { porta: 'conselho' } });
  assert.equal(a.status, 200);
  assert.deepEqual(a.resultado, { estado: 'analise_pronta', analiseAtual: 'v1', ok: true });
  assert.equal((await db.doc(`fichas/${id}`).get()).data().portaDecidida, 'conselho');
  const ev = (await eventos(id)).filter((e) => e.tipo === 'porta_decidida');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].detalhe, { de: null, para: 'conselho' });
  assert.deepEqual(ev[0].ator, { tipo: 'humano', id: admin.uid });
  const b = await chama(admin.token, { fichaId: id, acao: 'portaDecidida', parametros: { porta: 'conselho' } });
  assert.equal(b.status, 200);
  assert.equal((await eventos(id)).filter((e) => e.tipo === 'porta_decidida').length, 1);
  const c = await chama(admin.token, { fichaId: id, acao: 'portaDecidida', parametros: { porta: 'nenhuma' } });
  assert.equal(c.status, 200);
  const evs = (await eventos(id)).filter((e) => e.tipo === 'porta_decidida').map((e) => e.detalhe);
  assert.deepEqual(evs.find((d) => d.para === 'nenhuma'), { de: 'conselho', para: 'nenhuma' });
  assert.equal((await db.doc(`fichas/${id}`).get()).data().estado, 'analise_pronta');
});

test('portaDecidida: valid in aprovada and respondida; invalid value, missing value and invalid state', async () => {
  for (const estado of ['aprovada', 'respondida']) {
    const id = await criaFichaAnalisada(estado);
    assert.equal((await chama(admin.token, { fichaId: id, acao: 'portaDecidida', parametros: { porta: 'workshop' } })).status, 200);
    assert.equal((await db.doc(`fichas/${id}`).get()).data().estado, estado);
  }
  const id = await criaFichaAnalisada();
  for (const parametros of [{ porta: 'outra' }, {}, { porta: 3 }, undefined]) {
    const r = await chama(admin.token, { fichaId: id, acao: 'portaDecidida', parametros });
    assert.equal(codigo(r), 'parametro_invalido');
    assert.equal(r.erro.details.campo, 'porta');
  }
  assert.equal((await eventos(id)).length, 0);
  const rb = await criaFicha({ estado: 'resposta_breve' });
  assert.equal(codigo(await chama(admin.token, { fichaId: rb, acao: 'portaDecidida', parametros: { porta: 'projeto' } })), 'acao_invalida_no_estado');
  const sin = await criaFicha({ estado: 'sintetizando' });
  assert.equal(codigo(await chama(admin.token, { fichaId: sin, acao: 'portaDecidida', parametros: { porta: 'projeto' } })), 'ficha_em_processamento');
  const leit = await chama(leitor.token, { fichaId: id, acao: 'portaDecidida', parametros: { porta: 'projeto' } });
  assert.equal(codigo(leit), 'sem_permissao');
});

test('editar: writes vN+1 with the copied fields, a human author, s0 regenerated and analiseAtual moved; the state and prazoEm stay', async () => {
  const id = await criaFichaAnalisada('aprovada');
  const r = await chama(admin.token, { fichaId: id, acao: 'editar', parametros: { secao: 's2', corpo: '**Atividade.** texto novo do administrador', baseadaEm: 'v1' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.resultado, { estado: 'aprovada', analiseAtual: 'v2', ok: true });
  const f = (await db.doc(`fichas/${id}`).get()).data();
  assert.equal(f.analiseAtual, 'v2');
  assert.equal(f.estado, 'aprovada');
  assert.equal(f.lead.acao.prazoEm.toMillis(), ts('2026-11-18T12:00:00Z').toMillis());
  const v1 = (await db.doc(`fichas/${id}/analise/v1`).get()).data();
  assert.equal(v1.secoes.s2.corpo, 'corpo original de s2', 'v1 is never edited');
  const v2 = (await db.doc(`fichas/${id}/analise/v2`).get()).data();
  assert.deepEqual(v2.autor, { tipo: 'humano', id: admin.uid, origem: 'edicao' });
  assert.equal(v2.baseadaEm, 'v1');
  assert.equal(v2.versaoMetodo, 'm1');
  assert.deepEqual(v2.secoes.s2, { titulo: 'A empresa', corpo: '**Atividade.** texto novo do administrador', vazia: false, motivoVazia: null });
  for (const k of ['s1', 's3', 's4', 's5', 's6', 's7', 's8']) assert.deepEqual(v2.secoes[k], v1.secoes[k], k);
  assert.match(v2.secoes.s0.corpo, /Análise:\*\* v2/);
  assert.match(v2.secoes.s0.corpo, /\*\*Modelo:\*\* claude-sonnet-5-5 · edição humana$/);
  for (const k of ['enquadramento', 'resumoExecutivo', 'conversa', 'rascunhoResposta']) assert.deepEqual(v2[k], v1[k], k);
  for (const k of ['uso', 'correcao']) assert.equal(v2[k], undefined, `${k} is not copied`);
  const ev = (await eventos(id)).filter((e) => e.tipo === 'editada');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].detalhe, { secao: 's2', baseadaEm: 'v1', versao: 'v2' });
});

test('editar: an edit of an edit keeps one "edição humana" suffix and a new empty section becomes not vazia', async () => {
  const id = await criaFichaAnalisada();
  await db.doc(`fichas/${id}/analise/v1`).update({ 'secoes.s3.vazia': true, 'secoes.s3.motivoVazia': 'sem material' });
  assert.equal((await chama(admin.token, { fichaId: id, acao: 'editar', parametros: { secao: 's3', corpo: 'texto', baseadaEm: 'v1' } })).status, 200);
  const v2 = (await db.doc(`fichas/${id}/analise/v2`).get()).data();
  assert.equal(v2.secoes.s3.vazia, false);
  assert.equal(v2.secoes.s3.motivoVazia, null);
  assert.equal((await chama(admin.token, { fichaId: id, acao: 'editar', parametros: { secao: 's1', corpo: 'outro', baseadaEm: 'v2' } })).status, 200);
  const v3 = (await db.doc(`fichas/${id}/analise/v3`).get()).data();
  assert.match(v3.secoes.s0.corpo, /\*\*Modelo:\*\* claude-sonnet-5-5 · edição humana$/);
  assert.equal(v3.baseadaEm, 'v2');
  assert.equal((await db.doc(`fichas/${id}`).get()).data().analiseAtual, 'v3');
});

test('editar: conflito with a stale baseadaEm writes nothing; invalid parameters name the field', async () => {
  const id = await criaFichaAnalisada();
  assert.equal((await chama(admin.token, { fichaId: id, acao: 'editar', parametros: { secao: 's1', corpo: 'a', baseadaEm: 'v1' } })).status, 200);
  const velho = await chama(admin.token, { fichaId: id, acao: 'editar', parametros: { secao: 's1', corpo: 'b', baseadaEm: 'v1' } });
  assert.equal(codigo(velho), 'conflito');
  assert.equal((await db.collection(`fichas/${id}/analise`).get()).size, 2);
  assert.equal((await eventos(id)).filter((e) => e.tipo === 'editada').length, 1);
  const casos = [
    [{ secao: 's0', corpo: 'x', baseadaEm: 'v2' }, 'secao'], [{ secao: 's8', corpo: 'x', baseadaEm: 'v2' }, 'secao'], [{ corpo: 'x', baseadaEm: 'v2' }, 'secao'],
    [{ secao: 's1', corpo: '   ', baseadaEm: 'v2' }, 'corpo'], [{ secao: 's1', baseadaEm: 'v2' }, 'corpo'], [{ secao: 's1', corpo: 'x'.repeat(20_001), baseadaEm: 'v2' }, 'corpo'],
    [{ secao: 's1', corpo: 'x' }, 'baseadaEm'],
  ];
  for (const [parametros, campo] of casos) {
    const r = await chama(admin.token, { fichaId: id, acao: 'editar', parametros });
    assert.equal(codigo(r), 'parametro_invalido', JSON.stringify(parametros).slice(0, 60));
    assert.equal(r.erro.details.campo, campo);
  }
  assert.equal((await chama(admin.token, { fichaId: id, acao: 'editar', parametros: { secao: 's1', corpo: 'x'.repeat(20_000), baseadaEm: 'v2' } })).status, 200);
  assert.equal((await db.collection(`fichas/${id}/analise`).get()).size, 3);
});

test('editar: the title never comes from the client and invalid states are refused', async () => {
  const id = await criaFichaAnalisada();
  await chama(admin.token, { fichaId: id, acao: 'editar', parametros: { secao: 's4', titulo: 'Outro título', corpo: 'x', baseadaEm: 'v1' } });
  assert.equal((await db.doc(`fichas/${id}/analise/v2`).get()).data().secoes.s4.titulo, 'Potencial de mercado');
  const resp = await criaFichaAnalisada('respondida');
  assert.equal(codigo(await chama(admin.token, { fichaId: resp, acao: 'editar', parametros: { secao: 's1', corpo: 'x', baseadaEm: 'v1' } })), 'acao_invalida_no_estado');
  const sin = await criaFicha({ estado: 'sintetizando' });
  assert.equal(codigo(await chama(admin.token, { fichaId: sin, acao: 'editar', parametros: { secao: 's1', corpo: 'x', baseadaEm: 'v1' } })), 'ficha_em_processamento');
  assert.equal(codigo(await chama(semDoc.token, { fichaId: id, acao: 'editar', parametros: { secao: 's1', corpo: 'x', baseadaEm: 'v2' } })), 'sem_permissao');
  assert.equal(codigo(await chama(null, { fichaId: id, acao: 'editar', parametros: { secao: 's1', corpo: 'x', baseadaEm: 'v2' } })), 'nao_autenticado');
});

// --- reexecutar: sintese and qualificacao (phase 5b, second part) -------------------------------------------

test('reexecutar sintese: from each analysed state the ficha goes back to coletada, erro null, estadoEm renewed, event reexecucao', async () => {
  for (const estado of ['analise_pronta', 'analise_com_pendencias', 'aprovada']) {
    const id = await criaFichaAnalisada(estado);
    const antes = (await db.doc(`fichas/${id}`).get()).data();
    const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['sintese'] } });
    assert.equal(r.status, 200, estado);
    assert.deepEqual(r.resultado, { ok: true, estado: 'coletada', analiseAtual: 'v1' });
    const f = (await db.doc(`fichas/${id}`).get()).data();
    assert.equal(f.estado, 'coletada');
    assert.equal(f.erro ?? null, null);
    assert.ok(f.estadoEm.toMillis() > antes.estadoEm.toMillis());
    assert.equal(f.analiseAtual, 'v1');
    assert.deepEqual(f.lead.acao.prazoEm, antes.lead.acao.prazoEm);
    const ev = (await eventos(id)).filter((e) => e.tipo === 'reexecucao');
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0].detalhe, { alvos: ['sintese'] });
    assert.deepEqual(ev[0].ator, { tipo: 'humano', id: admin.uid });
    assert.equal((await db.collection(`fichas/${id}/analise`).get()).size, 1);
  }
});

test('reexecutar sintese: sintetizando with erro goes back to coletada; without erro it is ficha_em_processamento', async () => {
  const id = await criaFicha({ estado: 'sintetizando', erro: { etapa: 'sintetizar', mensagem: 'x', em: ts('2026-11-16T12:30:00Z') } });
  const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['sintese'] } });
  assert.equal(r.status, 200);
  const f = (await db.doc(`fichas/${id}`).get()).data();
  assert.equal(f.estado, 'coletada');
  assert.equal(f.erro, null);
  const sem = await criaFicha({ estado: 'sintetizando' });
  assert.equal(codigo(await chama(admin.token, { fichaId: sem, acao: 'reexecutar', parametros: { alvo: ['sintese'] } })), 'ficha_em_processamento');
});

test('reexecutar: parametro_invalido with campo alvo, and nothing is written', async () => {
  const id = await criaFichaAnalisada();
  const invalidos = [undefined, [], 'sintese', ['sintese', 'sintese'], ['sintese', 'setor'], ['qualificacao'], ['nada']];
  for (const alvo of invalidos) {
    const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo } });
    assert.equal(codigo(r), 'parametro_invalido', JSON.stringify(alvo));
    assert.equal(r.erro.details.campo, 'alvo');
  }
  const coleta = await criaFicha({ estado: 'coletando', erro: { etapa: 'coletar', mensagem: 'x', em: ts('2026-11-16T12:30:00Z') } });
  assert.equal(codigo(await chama(admin.token, { fichaId: coleta, acao: 'reexecutar', parametros: { alvo: ['sintese'] } })), 'parametro_invalido');
  assert.equal((await db.doc(`fichas/${id}`).get()).data().estado, 'analise_pronta');
  assert.deepEqual(await tiposDe(id), []);
});

test('reexecutar qualificacao: with erro.etapa qualificar (coleta_minima) and graduar (qualificada) it clears erro and keeps the state', async () => {
  for (const [estado, etapa] of [['coleta_minima', 'qualificar'], ['qualificada', 'graduar']]) {
    const id = await criaFicha({ estado, erro: { etapa, mensagem: 'x', em: ts('2026-11-16T12:30:00Z') } });
    const antes = (await db.doc(`fichas/${id}`).get()).data();
    const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['qualificacao'] } });
    assert.equal(r.status, 200, estado);
    assert.equal(r.resultado.estado, estado);
    const f = (await db.doc(`fichas/${id}`).get()).data();
    assert.equal(f.estado, estado);
    assert.equal(f.erro, null);
    assert.ok(f.estadoEm.toMillis() > antes.estadoEm.toMillis());
    assert.equal(f.lead, undefined);
    assert.deepEqual((await eventos(id)).filter((e) => e.tipo === 'reexecucao').map((e) => e.detalhe), [{ alvos: ['qualificacao'] }]);
  }
});

test('reexecutar qualificacao: other erro.etapa, other states and a combination are parametro_invalido', async () => {
  const casos = [
    [{ estado: 'coleta_minima', erro: { etapa: 'coleta_minima' } }, ['qualificacao']],
    [{ estado: 'coleta_minima', erro: { etapa: 'interrupcao:coleta_minima' } }, ['qualificacao']],
    [{ estado: 'qualificada', erro: { etapa: 'qualificar' } }, ['qualificacao']],
    [{ estado: 'coleta_minima', erro: { etapa: 'qualificar' } }, ['qualificacao', 'sintese']],
  ];
  for (const [campos, alvo] of casos) {
    const id = await criaFicha({ ...campos, erro: { ...campos.erro, mensagem: 'x', em: ts('2026-11-16T12:30:00Z') } });
    const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo } });
    assert.equal(codigo(r), 'parametro_invalido', JSON.stringify(campos));
    assert.equal((await db.doc(`fichas/${id}`).get()).data().erro.etapa, campos.erro.etapa);
  }
  const pronta = await criaFichaAnalisada();
  assert.equal(codigo(await chama(admin.token, { fichaId: pronta, acao: 'reexecutar', parametros: { alvo: ['qualificacao'] } })), 'parametro_invalido');
});

test('confiancaFinal: prazoEm is written only when it is still null (spec 01 v0.26)', async () => {
  const { confiancaFinal } = await import('../lib/graduar.js');
  const lead = (prazoEm) => ({ quadrante: 'priorizar', grau: 'A', pontos: 80, destino: 'convidar', modificadores: { escopo: 'aprovado' }, acao: { prazoDiasUteis: 2, prazoEm } });
  const id = await criaFicha({ estado: 'analise_pronta' });
  const ref = db.doc(`fichas/${id}`);
  const nulo = await confiancaFinal(ref, { lead: lead(null) }, false, new Date('2026-11-16T12:00:00Z'));
  assert.ok(nulo['lead.acao.prazoEm'] instanceof Timestamp);
  const preenchido = await confiancaFinal(ref, { lead: lead(ts('2026-11-18T12:00:00Z')) }, false, new Date('2026-11-17T12:00:00Z'));
  assert.equal('lead.acao.prazoEm' in preenchido, false);
  assert.ok('lead.modificadores.confianca' in preenchido);
});

test('reexecutar sintese: coletada with erro (interruption marked by vigiar) renews estadoEm, clears erro and keeps the state', async () => {
  for (const etapa of ['interrupcao:coletada', 'sintetizar']) {
    const id = await criaFicha({ estado: 'coletada', erro: { etapa, mensagem: 'x', em: ts('2026-11-16T12:30:00Z') } });
    const antes = (await db.doc(`fichas/${id}`).get()).data();
    const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['sintese'] } });
    assert.equal(r.status, 200, etapa);
    assert.equal(r.resultado.estado, 'coletada');
    const f = (await db.doc(`fichas/${id}`).get()).data();
    assert.equal(f.estado, 'coletada');
    assert.equal(f.erro, null);
    assert.ok(f.estadoEm.toMillis() > antes.estadoEm.toMillis());
    assert.deepEqual((await eventos(id)).filter((e) => e.tipo === 'reexecucao').map((e) => e.detalhe), [{ alvos: ['sintese'] }]);
  }
  const sem = await criaFicha({ estado: 'coletada' });
  assert.equal(codigo(await chama(admin.token, { fichaId: sem, acao: 'reexecutar', parametros: { alvo: ['sintese'] } })), 'acao_invalida_no_estado');
});

test('vigiar: a ficha stopped in coletada gets erro interrupcao:coletada and the parada event; a recent one is left alone', async () => {
  const { marcaParadas } = await import('../lib/vigiar.js');
  const agora = new Date();
  const parada = await criaFicha({ estado: 'coletada', estadoEm: Timestamp.fromDate(new Date(agora.getTime() - 3 * 3_600_000)) });
  const recente = await criaFicha({ estado: 'coletada', estadoEm: Timestamp.fromDate(new Date(agora.getTime() - 60_000)) });
  await marcaParadas(agora, db, 30);
  const f = (await db.doc(`fichas/${parada}`).get()).data();
  assert.equal(f.erro.etapa, 'interrupcao:coletada');
  assert.deepEqual((await eventos(parada)).filter((e) => e.tipo === 'parada').map((e) => e.detalhe.estado), ['coletada']);
  assert.equal((await db.doc(`fichas/${recente}`).get()).data().erro ?? null, null);
  // After the mark, reexecutar sintese is the way out.
  const r = await chama(admin.token, { fichaId: parada, acao: 'reexecutar', parametros: { alvo: ['sintese'] } });
  assert.equal(r.status, 200);
});
