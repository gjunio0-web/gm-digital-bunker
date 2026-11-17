// acaoAdmin against the Firebase emulators (functions + firestore + auth), run by `npm run emulador` after
// emulador.test.mjs, one file at a time (--test-concurrency=1) because some tests change config/pipeline.
// Real callable calls with an ID token from the Auth emulator; fichas are written directly with the admin SDK.
// A ficha sent to coletando triggers the real coletar on a ficha without a pipeline history; the tests only
// look at what the action wrote and delete the fichas at the end.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { executaAcao, ErroAcao } from '../lib/acaoAdmin.js';
import { diaDeSaoPaulo } from '../lib/graduar.js';
import { limpaControle } from '../lib/expurgar.js';
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
  const id = await criaFicha({ estado: 'resposta_breve', lead: { destino: 'encerrar', destinoAlterado: false, acao: { prazoDiasUteis: 2, prazoEm: ts('2026-11-18T12:00:00Z') } }, expurgoEm: ts('2026-12-01T12:00:00Z') });
  const r = await chama(admin.token, { fichaId: id, acao: 'mandarParaAnalise' });
  assert.equal(r.status, 200);
  assert.equal(r.resultado.estado, 'coletando');
  const f = (await db.doc(`fichas/${id}`).get()).data();
  assert.equal(f.lead.destinoAlterado, true);
  // The triagem deadline of the Declinar ficha is cleared (the hub must not show it while the analysis runs).
  assert.equal(f.lead.acao.prazoEm, null);
  assert.equal(f.lead.acao.prazoDiasUteis, 2);
  assert.equal(f.expurgoEm.toMillis(), ts('2026-11-16T12:00:00Z').toMillis() + 90 * DIA_MS);
  assert.ok((await tiposDe(id)).includes('destino_alterado'));
  assert.equal((await db.doc(`controle/analises-${dia}`).get()).data().n, 1);
});

test('mandarParaAnalise from a held qualificada: retencao_liberada manual, retencao null, destinoAlterado unchanged, counted in the day', async () => {
  const dia = diaDeSaoPaulo(new Date());
  await db.doc(`controle/analises-${dia}`).delete();
  await db.doc('config/pipeline').set({ maxAnalisesPorDia: 0 }, { merge: true });
  for (const motivo of ['teto_diario', 'auto_desligada']) {
    const id = await criaFicha({ estado: 'qualificada', lead: { destino: 'convidar', destinoAlterado: false, acao: { prazoDiasUteis: 2, prazoEm: null } }, retencao: { motivo, desde: Timestamp.now(), liberacaoPrevista: null } });
    const r = await chama(admin.token, { fichaId: id, acao: 'mandarParaAnalise' });
    assert.equal(r.resultado.estado, 'coletando');
    const f = (await db.doc(`fichas/${id}`).get()).data();
    assert.equal(f.retencao, null);
    assert.equal(f.lead.destinoAlterado, false);
    assert.equal(f.lead.acao.prazoEm, null); // born null for a held ficha; the action leaves it as it is
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
  const r = await fetch(`http://127.0.0.1:5001/${PROJETO}/southamerica-east1/publicarMetodo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versao: 'abc1234', arquivos }) });
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
    // qualificar moves the ficha out of coleta_minima before graduar writes the lead: wait for the lead (or an erro).
    return d.lead || d.erro ? d : null;
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

// Since spec 01 v0.41 a coleta_minima ficha accepts qualificacao with any erro.etapa, but only with both minimal stages usable;
// here there are no stage documents, so the first two cases are still refused (the stage rule is tested further down).
test('reexecutar qualificacao: without usable stage documents, in qualificada with another etapa and in a combination it is parametro_invalido', async () => {
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

test('limpaControle: old daily counters are summed into metricas.retidasTeto of their month and deleted, in one batch; the rest is left alone', async () => {
  const agora = new Date('2026-11-16T15:00:00Z');
  const t = ts('2026-11-16T12:00:00Z');
  await db.doc('controle/analises-2026-08-30').set({ dia: '2026-08-30', n: 4, retidas: 2, atualizadoEm: t });
  await db.doc('controle/analises-2026-08-31').set({ dia: '2026-08-31', n: 1, retidas: 3, atualizadoEm: t });
  await db.doc('controle/analises-2026-09-02').set({ dia: '2026-09-02', n: 5, atualizadoEm: t }); // no retidas: deleted, adds nothing
  await db.doc('controle/analises-2026-10-17').set({ dia: '2026-10-17', n: 1, retidas: 9, atualizadoEm: t }); // exactly 30 days: kept
  await db.doc('controle/analises-2026-11-15').set({ dia: '2026-11-15', n: 1, retidas: 9, atualizadoEm: t });
  await db.doc('controle/outro-documento').set({ qualquer: 1, retidas: 7 }); // not a daily counter: untouched
  await db.doc('metricas/2026-08').set({ retidasTeto: 1, custo: { sintese: { versoes: 2 } } }); // existing month: incremented, rest kept
  const r = await limpaControle(db, agora);
  assert.deepEqual(r, { apagados: 3, retidas: 5 });
  assert.equal((await db.doc('metricas/2026-08').get()).get('retidasTeto'), 6);
  assert.equal((await db.doc('metricas/2026-08').get()).get('custo.sintese.versoes'), 2);
  assert.equal((await db.doc('metricas/2026-09').get()).exists, false); // sum 0: no write
  for (const id of ['analises-2026-08-30', 'analises-2026-08-31', 'analises-2026-09-02']) assert.equal((await db.doc(`controle/${id}`).get()).exists, false, id);
  for (const id of ['analises-2026-10-17', 'analises-2026-11-15', 'outro-documento']) assert.equal((await db.doc(`controle/${id}`).get()).exists, true, id);
  // A second run changes nothing: nothing is counted twice.
  assert.deepEqual(await limpaControle(db, agora), { apagados: 0, retidas: 0 });
  assert.equal((await db.doc('metricas/2026-08').get()).get('retidasTeto'), 6);
  for (const c of ['analises-2026-10-17', 'analises-2026-11-15', 'outro-documento']) await db.doc(`controle/${c}`).delete();
  await db.doc('metricas/2026-08').delete();
});

// ---- ficha in qualificada with lead AND erro.etapa = graduar (Hub question of 17/11/2026) ----
// Documents what happens today; it does not assert that this is the desired behavior. See the notes in each test.
// The lib code (graduaTriagem, retomarTriagem) calls getFirestore() on the default app; this file uses a named app.
const garanteAppPadrao = () => { if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROJETO }); };
const leadDeTeste = { momento: 'triagem', quadrante: 'Q2', grau: 'B', pontos: 55, destino: 'analise', versaoPesos: 'p1', modificadores: {}, acao: { prazoEm: null }, calculadoEm: ts('2026-11-16T12:10:00Z') };

test('lead + erro graduar: reexecutar qualificacao only clears erro; lead and state stay, retomarTriagem and graduaTriagem do nothing', async () => {
  const { deveRetomar } = await import('../lib/retomarTriagem.js');
  const { graduaTriagem } = await import('../lib/graduar.js');
  garanteAppPadrao();
  const erro = { etapa: 'graduar', mensagem: 'graduar: ficha changed meanwhile', em: ts('2026-11-16T12:30:00Z') };
  const id = await criaFicha({ estado: 'qualificada', ...camposDeColeta, lead: leadDeTeste, erro });
  const antes = (await db.doc(`fichas/${id}`).get()).data();
  const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['qualificacao'] } });
  const depois = (await db.doc(`fichas/${id}`).get()).data();
  console.log('[lead+erro] action status', r.status, JSON.stringify(r.resultado ?? r.erro));
  console.log('[lead+erro] after action: estado', depois.estado, 'erro', JSON.stringify(depois.erro), 'lead kept', JSON.stringify(depois.lead) === JSON.stringify(antes.lead), 'estadoEm advanced', depois.estadoEm.toMillis() > antes.estadoEm.toMillis());
  assert.equal(r.status, 200);
  assert.equal(depois.estado, 'qualificada');
  assert.equal(depois.erro, null);
  assert.deepEqual(depois.lead, antes.lead);
  assert.ok(depois.estadoEm.toMillis() > antes.estadoEm.toMillis());
  assert.deepEqual((await eventos(id)).map((e) => [e.tipo, e.detalhe]), [['reexecucao', { alvos: ['qualificacao'], apenasLimpouErro: true }]]); // spec 01 v0.39

  // Trigger condition: with lead present it does not fire; the same transition without lead would.
  assert.equal(deveRetomar(antes, depois), null);
  assert.equal(deveRetomar(antes, { ...depois, lead: undefined }), 'graduar');
  // graduaTriagem returns null before touching the pipeline when lead exists (second argument is not read).
  assert.equal(await graduaTriagem(db.doc(`fichas/${id}`), {}), null);

  // Whatever the deployed retomarTriagem did with the update, the ficha must be unchanged after a wait.
  await espera(4000);
  const fim = (await db.doc(`fichas/${id}`).get()).data();
  assert.equal(fim.erro, null);
  assert.equal(fim.estadoEm.toMillis(), depois.estadoEm.toMillis());
  assert.deepEqual(fim.lead, antes.lead);
  assert.deepEqual(await tiposDe(id), ['reexecucao']);
});

test('two concurrent retomarTriagem runs on the same ficha (duplicated delivery), repeated 5 times: no erro is recorded (spec 01 v0.39)', async (t) => {
  const { retomarTriagem } = await import('../lib/retomarTriagem.js');
  garanteAppPadrao();
  await garanteMetodo();
  const anterior = process.env.FUNCTIONS_EMULATOR;
  process.env.FUNCTIONS_EMULATOR = 'true'; // no secrets read, as in the emulator
  const resumo = [];
  try {
    for (let i = 0; i < 5; i++) {
      const id = await criaFicha({ estado: 'qualificada', ...camposDeColeta, erro: null });
      await etapaDoc(id, 'empresa_digital', concluida);
      await etapaDoc(id, 'empresa_registro', concluida);
      const dados = (await db.doc(`fichas/${id}`).get()).data();
      const evento = { params: { id }, data: { before: { data: () => ({ ...dados, erro: { etapa: 'graduar', mensagem: 'x', em: ts('2026-11-16T12:30:00Z') } }) }, after: { data: () => dados } } };
      await Promise.all([retomarTriagem.run(evento), retomarTriagem.run(evento)]);
      await espera(500);
      const f = (await db.doc(`fichas/${id}`).get()).data();
      const triadas = (await tiposDe(id)).filter((x) => x === 'triada').length;
      resumo.push({ lead: Boolean(f.lead), erro: f.erro?.etapa ?? null, mensagem: f.erro?.mensagem ?? null, triadas, estado: f.estado });
      // Spec 01 v0.39: the loser's catch finds the ficha past the step and records nothing.
      assert.ok(f.lead, `round ${i}: lead`);
      assert.equal(triadas, 1, `round ${i}: triada events`);
      assert.equal(f.erro ?? null, null, `round ${i}: no erro on a ficha whose triagem the other run concluded`);
    }
  } finally {
    if (anterior === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = anterior;
  }
  console.log('[race] rounds:', JSON.stringify(resumo));
  t.diagnostic(`rounds with lead + erro: ${resumo.filter((x) => x.lead && x.erro).length} of ${resumo.length}`);
});

// End to end (decision of Gon, 17/11/2026): a real failure of graduar records erro in qualificada without lead,
// Reexecutar > Qualificacao clears it through the callable, and the real retomarTriagem trigger redoes the triagem.
test('graduar failure in qualificada without lead: erro is recorded, acaoAdmin clears it and the triagem is redone (one triada, lead, no erro)', async () => {
  const { retomarTriagem } = await import('../lib/retomarTriagem.js');
  garanteAppPadrao();
  await garanteMetodo();
  const ref = (id) => db.doc(`fichas/${id}`);
  const antigo = { etapa: 'graduar', mensagem: 'x', em: ts('2026-11-16T12:30:00Z') };
  // recebidaEm null makes graduaTriagem throw inside the step (the real failure path, no mocks).
  const id = await criaFicha({ estado: 'qualificada', ...camposDeColeta, recebidaEm: null, erro: null });
  await etapaDoc(id, 'empresa_digital', concluida);
  await etapaDoc(id, 'empresa_registro', concluida);

  // (i) the failure: the real handler runs and its catch records the erro
  const anterior = process.env.FUNCTIONS_EMULATOR;
  process.env.FUNCTIONS_EMULATOR = 'true';
  try {
    const dados = (await ref(id).get()).data();
    await retomarTriagem.run({ params: { id }, data: { before: { data: () => ({ ...dados, erro: antigo }) }, after: { data: () => dados } } });
  } finally {
    if (anterior === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = anterior;
  }
  const falhou = (await ref(id).get()).data();
  console.log('[e2e] after the failure: estado', falhou.estado, 'erro.etapa', falhou.erro?.etapa, 'lead', Boolean(falhou.lead));
  assert.equal(falhou.estado, 'qualificada');
  assert.equal(falhou.erro?.etapa, 'graduar');
  assert.equal(falhou.lead, undefined);
  assert.deepEqual(await tiposDe(id), [], 'no triada yet');

  // the cause is fixed (the ficha gets its date), without touching erro, so no trigger fires
  await ref(id).update({ recebidaEm: ts('2026-11-16T12:00:00Z') });
  await espera(1500);
  assert.equal((await ref(id).get()).data().erro?.etapa, 'graduar', 'erro is still there until someone clears it');

  // (ii) Reexecutar > Qualificacao through the callable clears it
  const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['qualificacao'] } });
  assert.equal(r.status, 200);
  assert.equal(r.resultado.ok, true);

  // (iii) the real trigger redoes the triagem
  const f = await ate(async () => { const d = (await ref(id).get()).data(); return d.lead ? d : null; });
  assert.ok(f, 'graduar ran again and wrote the lead');
  const tipos = await tiposDe(id);
  console.log('[e2e] after reexecutar: estado', f.estado, 'erro', JSON.stringify(f.erro ?? null), 'eventos', JSON.stringify(tipos));
  assert.equal(f.erro ?? null, null);
  assert.equal(tipos.filter((x) => x === 'triada').length, 1);
  assert.equal(tipos.filter((x) => x === 'reexecucao').length, 1);
  assert.deepEqual((await eventos(id)).find((e) => e.tipo === 'reexecucao').detalhe, { alvos: ['qualificacao'] }, 'no lead at the time: not "apenasLimpouErro"');
});

// ---- gravaErro (spec 01 v0.39): an erro of a triagem step is recorded only where the step runs ----
test('gravaErro: graduar and qualificar are recorded only in the state where the step runs', async () => {
  const { gravaErro } = await import('../lib/erroTriagem.js');
  garanteAppPadrao();
  const le = async (id) => (await db.doc(`fichas/${id}`).get()).data();
  const casos = [
    // [estado, lead, etapa, expected result]
    ['qualificada', undefined, 'graduar', true],
    ['qualificada', leadDeTeste, 'graduar', false],
    ['resposta_breve', leadDeTeste, 'graduar', false],
    ['coletando', leadDeTeste, 'graduar', false],
    ['coleta_minima', undefined, 'qualificar', true],
    ['qualificada', undefined, 'qualificar', false],
    ['coletando', leadDeTeste, 'qualificar', false],
    ['coleta_minima', undefined, 'coleta_minima', true], // other steps keep the plain write
    ['qualificada', leadDeTeste, 'coleta_minima', true],
  ];
  for (const [estado, lead, etapa, esperado] of casos) {
    const id = await criaFicha({ estado, ...camposDeColeta, ...(lead ? { lead } : {}) });
    const gravou = await gravaErro(db.doc(`fichas/${id}`), etapa, 'falha de teste');
    const f = await le(id);
    assert.equal(gravou, esperado, `${estado} lead=${Boolean(lead)} ${etapa}`);
    assert.equal(f.erro?.etapa ?? null, esperado ? etapa : null, `${estado} ${etapa}: erro`);
    if (esperado) assert.equal(f.erro.mensagem, 'falha de teste');
    assert.deepEqual(await tiposDe(id), [], 'no event is written for an erro');
  }
  assert.equal(await gravaErro(db.doc('fichas/nao-existe-erro'), 'graduar', 'x'), false); // a missing ficha records nothing
});

// ---- daily-ceiling notice (spec 01 v0.39, option A): avisado only after a successful send ----
test('enviaAvisoTeto: a failed send does not mark avisado; a successful one does; it never throws', async () => {
  const { enviaAvisoTeto } = await import('../lib/triagem.js');
  garanteAppPadrao();
  const dia = '2099-01-01';
  const ref = db.doc(`controle/analises-${dia}`);
  await ref.delete().catch(() => {});
  try {
    assert.equal(await enviaAvisoTeto('k', 3, dia, async () => { throw new Error('smtp down'); }), false);
    assert.notEqual((await ref.get()).data()?.avisado, true);
    assert.equal(await enviaAvisoTeto('k', 3, dia, async () => {}), true);
    assert.equal((await ref.get()).data().avisado, true);
  } finally {
    await ref.delete().catch(() => {});
  }
});

test('ceiling notice: graduaTriagem does not write avisado; after a failed send the next ficha over the ceiling asks again; after a successful one none does', async () => {
  const { qualifica } = await import('../lib/qualificar.js');
  const { graduaTriagem, diaDeSaoPaulo: dia } = await import('../lib/graduar.js');
  const { enviaAvisoTeto } = await import('../lib/triagem.js');
  const { lePipeline } = await import('../lib/pipeline.js');
  garanteAppPadrao();
  await garanteMetodo();
  const hoje = dia(new Date());
  const contador = db.doc(`controle/analises-${hoje}`);
  const anterior = process.env.FUNCTIONS_EMULATOR;
  process.env.FUNCTIONS_EMULATOR = 'true'; // qualificar without the model, as in the emulator
  try {
    await contador.set({ dia: hoje, n: 5 }); // the day is at the ceiling of 5
    const p = { ...(await lePipeline()), maxAnalisesPorDia: 5, autoAnalisar: true };
    // A ficha that left the coleta mínima and is classified, then goes through graduaTriagem like the handlers do.
    const triada = async () => {
      const id = await criaFicha({ estado: 'coleta_minima', ...camposDeColeta });
      await etapaDoc(id, 'empresa_digital', concluida);
      await etapaDoc(id, 'empresa_registro', concluida);
      await db.doc(`fichas/${id}`).update({ 'original.mensagem': 'Queremos sair das planilhas com apoio de um conselho.' });
      const ref = db.doc(`fichas/${id}`);
      await qualifica(ref, p, '');
      const g = await graduaTriagem(ref, p);
      assert.ok(g, 'graduaTriagem ran');
      assert.equal(g.estado, 'qualificada', `held by the ceiling (quadrante ${g.lead.quadrante}); the fixture must reach coletando`);
      return g;
    };
    const a = await triada();
    assert.ok(a.avisarTeto, 'the first ficha over the ceiling asks for the notice');
    assert.notEqual((await contador.get()).data().avisado, true, 'the transaction no longer writes avisado');
    assert.equal(await enviaAvisoTeto('k', 5, hoje, async () => { throw new Error('smtp down'); }), false);
    const b = await triada();
    assert.ok(b.avisarTeto, 'after a failed send the next ficha over the ceiling asks again');
    assert.equal(await enviaAvisoTeto('k', 5, hoje, async () => {}), true);
    const c = await triada();
    assert.equal(c.avisarTeto, null, 'after a successful send nobody asks again that day');
    assert.equal((await contador.get()).data().avisado, true);
  } finally {
    if (anterior === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = anterior;
    await contador.delete().catch(() => {});
  }
});

// The tests below start real pipelines in the emulator; they stay at the end so that no later test shares the daily ceiling
// counter or the fichas still in flight with them.
// ---- spec 01 v0.41: every state with erro has at least one valid target of reexecutar ----
const erroDe = (etapa) => ({ etapa, mensagem: 'x', em: ts('2026-11-16T12:30:00Z') });
const MENSAGEM_CURTA = 'Queremos sair das planilhas com apoio de um conselho.';
// A ficha in recebida that no creation trigger touches: it is created in another state and moved afterwards.
async function criaFichaRecebida(campos) {
  const id = await criaFicha({ estado: 'arquivada', ...camposDeColeta, ...campos });
  // The real coletarMinima (onCreate) is delivered a moment after the creation; if the ficha were already in recebida
  // by then it would claim it and move it on. Let it see "arquivada" and do nothing first.
  await espera(2000);
  await db.doc(`fichas/${id}`).update({ 'original.mensagem': MENSAGEM_CURTA, estado: 'recebida' });
  return id;
}

test('reexecutar qualificacao (coleta_minima, v0.41): interrupcao and coleta_minima with both minimal stages usable redo the triagem; one stage pendente is refused', async () => {
  await garanteMetodo();
  const inteira = { ...falhou, preservado: { blocos: ['etapa'] } };
  for (const [etapa, registro] of [['interrupcao:coleta_minima', concluida], ['coleta_minima', inteira]]) {
    const id = await criaFicha({ estado: 'coleta_minima', ...camposDeColeta, erro: erroDe(etapa) });
    await db.doc(`fichas/${id}`).update({ 'original.mensagem': MENSAGEM_CURTA });
    await etapaDoc(id, 'empresa_digital', concluida);
    await etapaDoc(id, 'empresa_registro', registro);
    const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['qualificacao'] } });
    assert.equal(r.status, 200, etapa);
    const f = await ate(async () => { const d = (await db.doc(`fichas/${id}`).get()).data(); return d.lead ? d : null; });
    assert.ok(f, `${etapa}: the triagem ran again and wrote the lead`);
    assert.equal(f.erro ?? null, null, etapa);
    const tipos = await tiposDe(id);
    assert.equal(tipos.filter((x) => x === 'triada').length, 1, etapa);
    assert.deepEqual((await eventos(id)).find((e) => e.tipo === 'reexecucao').detalhe, { alvos: ['qualificacao'] }, etapa);
  }
  for (const pendente of [{ status: 'pendente' }, undefined]) {
    const id = await criaFicha({ estado: 'coleta_minima', ...camposDeColeta, erro: erroDe('interrupcao:coleta_minima') });
    await etapaDoc(id, 'empresa_digital', concluida);
    if (pendente) await etapaDoc(id, 'empresa_registro', pendente);
    const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['qualificacao'] } });
    assert.equal(codigo(r), 'parametro_invalido', JSON.stringify(pendente));
    const f = (await db.doc(`fichas/${id}`).get()).data();
    assert.equal(f.erro.etapa, 'interrupcao:coleta_minima');
    assert.deepEqual(await tiposDe(id), []);
  }
});

test('reexecutar sintese (coletando, v0.41): erro with the six stages usable goes to coletada; a stage not usable or missing refuses it', async () => {
  const id = await criaFicha({ estado: 'coletando', ...camposDeColeta, erro: erroDe('interrupcao:coletando') });
  for (const e of ETAPAS_COLETA) await etapaDoc(id, e, concluida);
  const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['sintese'] } });
  assert.equal(r.status, 200);
  assert.equal(r.resultado.estado, 'coletada');
  assert.deepEqual((await eventos(id)).find((e) => e.tipo === 'reexecucao').detalhe, { alvos: ['sintese'] });
  // A stage that failed without preserved data, a pendente one and a missing document each refuse sintese.
  for (const [rotulo, doc] of [['falhou', falhou], ['pendente', { status: 'pendente' }], ['sem documento', null]]) {
    const outra = await criaFicha({ estado: 'coletando', ...camposDeColeta, erro: erroDe('interrupcao:coletando') });
    for (const e of ETAPAS_COLETA.slice(0, 5)) await etapaDoc(outra, e, concluida);
    if (doc) await etapaDoc(outra, 'mercado', doc);
    const n = await chama(admin.token, { fichaId: outra, acao: 'reexecutar', parametros: { alvo: ['sintese'] } });
    assert.equal(codigo(n), 'parametro_invalido', rotulo);
    const f = (await db.doc(`fichas/${outra}`).get()).data();
    assert.equal(f.estado, 'coletando', rotulo);
    assert.equal(f.erro.etapa, 'interrupcao:coletando', rotulo);
    assert.deepEqual(await tiposDe(outra), [], rotulo);
  }
});

test('reexecutar coleta_minima (recebida, v0.41): erro is cleared, retomarRecebida starts the collection again; without erro or with another alvo it is refused', async () => {
  await garanteMetodo();
  const id = await criaFichaRecebida({ erro: erroDe('coleta_minima') });
  const r = await chama(admin.token, { fichaId: id, acao: 'reexecutar', parametros: { alvo: ['coleta_minima'] } });
  assert.equal(r.status, 200);
  assert.equal(r.resultado.estado, 'recebida');
  const f = await ate(async () => { const d = (await db.doc(`fichas/${id}`).get()).data(); return d.estado !== 'recebida' && d.lead ? d : null; });
  assert.ok(f, 'the ficha left recebida after the collection and the triagem ran');
  assert.equal(f.erro ?? null, null);
  const tipos = await tiposDe(id);
  console.log('[recebida] events', JSON.stringify(tipos), 'estado', f.estado);
  for (const t of ['reexecucao', 'coleta_minima', 'triada']) assert.equal(tipos.filter((x) => x === t).length, 1, t);
  assert.deepEqual((await eventos(id)).find((e) => e.tipo === 'reexecucao').detalhe, { alvos: ['coleta_minima'] });

  const semErro = await criaFichaRecebida({ erro: null });
  assert.equal(codigo(await chama(admin.token, { fichaId: semErro, acao: 'reexecutar', parametros: { alvo: ['coleta_minima'] } })), 'acao_invalida_no_estado');
  const comErro = await criaFichaRecebida({ erro: erroDe('coleta_minima') });
  for (const alvo of [['empresa_digital'], ['sintese'], ['qualificacao'], ['coleta_minima', 'setor']]) {
    assert.equal(codigo(await chama(admin.token, { fichaId: comErro, acao: 'reexecutar', parametros: { alvo } })), 'parametro_invalido', JSON.stringify(alvo));
  }
  const fim = (await db.doc(`fichas/${comErro}`).get()).data();
  assert.equal(fim.estado, 'recebida');
  assert.equal(fim.erro.etapa, 'coleta_minima');
  assert.deepEqual(await tiposDe(comErro), []);
});

test('executaColetaMinima: two simultaneous runs on a ficha in recebida (duplicated delivery) collect once', async () => {
  const { executaColetaMinima } = await import('../lib/coletaMinimaCorpo.js');
  garanteAppPadrao();
  await garanteMetodo();
  const anterior = process.env.FUNCTIONS_EMULATOR;
  process.env.FUNCTIONS_EMULATOR = 'true';
  try {
    const id = await criaFichaRecebida({ erro: null });
    await Promise.all([executaColetaMinima(id), executaColetaMinima(id)]);
    await espera(500);
    const tipos = await tiposDe(id);
    const f = (await db.doc(`fichas/${id}`).get()).data();
    console.log('[recebida x2] events', JSON.stringify(tipos), 'estado', f.estado);
    assert.equal(tipos.filter((x) => x === 'coleta_minima').length, 1);
    assert.equal(tipos.filter((x) => x === 'triada').length, 1);
    assert.equal(f.erro ?? null, null);
    assert.ok(f.lead);
  } finally {
    if (anterior === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = anterior;
  }
});

test('vigiar: a ficha stopped in recebida gets erro interrupcao:recebida and the parada event, and reexecutar coleta_minima is the way out', async () => {
  const { marcaParadas } = await import('../lib/vigiar.js');
  const agora = new Date();
  const antiga = Timestamp.fromDate(new Date(agora.getTime() - 3 * 3_600_000));
  const parada = await criaFichaRecebida({ erro: null, estadoEm: antiga });
  const recente = await criaFichaRecebida({ erro: null, estadoEm: Timestamp.now() }); // criaFicha's default estadoEm is a past fixed date
  const comErro = await criaFichaRecebida({ erro: erroDe('coleta_minima'), estadoEm: antiga });
  const lista = await marcaParadas(agora, db, 30);
  assert.ok(lista.some((x) => x.estado === 'recebida'), 'the notice lists the ficha');
  assert.equal((await db.doc(`fichas/${parada}`).get()).data().erro.etapa, 'interrupcao:recebida');
  assert.deepEqual((await eventos(parada)).filter((e) => e.tipo === 'parada').map((e) => e.detalhe.estado), ['recebida']);
  assert.equal((await db.doc(`fichas/${recente}`).get()).data().erro ?? null, null);
  assert.equal((await db.doc(`fichas/${comErro}`).get()).data().erro.etapa, 'coleta_minima', 'a ficha that already has erro is left alone');
  const r = await chama(admin.token, { fichaId: parada, acao: 'reexecutar', parametros: { alvo: ['coleta_minima'] } });
  assert.equal(r.status, 200);
});

test('enviaEmailsDaFicha (v0.42): each failed e-mail becomes one email_falhou event with its destino, never an erro; the ficha keeps its state and vigiar still marks a real stop', async () => {
  const { enviaEmailsDaFicha } = await import('../lib/receberFicha.js');
  const { marcaParadas } = await import('../lib/vigiar.js');
  const ok = async () => undefined;
  const falha = async () => { throw new Error('smtp fora do ar'); };
  const casos = [
    [{ confirmacao: ok, aviso: ok }, []],
    [{ confirmacao: falha, aviso: ok }, ['interessado']],
    [{ confirmacao: ok, aviso: falha }, ['administrador']],
    [{ confirmacao: falha, aviso: falha }, ['interessado', 'administrador']],
  ];
  const antiga = Timestamp.fromDate(new Date(Date.now() - 3 * 3_600_000));
  for (const [envios, esperado] of casos) {
    const id = await criaFicha({ estado: 'coleta_minima', ...camposDeColeta, estadoEm: antiga });
    const ref = db.doc(`fichas/${id}`);
    const original = (await ref.get()).data().original;
    const falhas = await enviaEmailsDaFicha(ref, 'chave', original, null, new Date(), envios);
    assert.deepEqual(falhas, esperado);
    const evs = (await eventos(id)).filter((e) => e.tipo === 'email_falhou');
    assert.deepEqual(evs.map((e) => e.detalhe.destino).sort(), [...esperado].sort(), JSON.stringify(esperado));
    assert.ok(evs.every((e) => e.ator.id === 'receberFicha'));
    const f = (await ref.get()).data();
    assert.equal(f.erro ?? null, null, 'no erro on the ficha');
    assert.equal(f.estado, 'coleta_minima');
    // The stop of a ficha with an e-mail failure is still caught by vigiar (it ignores only fichas with erro).
    await marcaParadas(new Date(), db, 30);
    assert.equal((await ref.get()).data().erro?.etapa, 'interrupcao:coleta_minima', JSON.stringify(esperado));
  }
});
