// End-to-end test against the Firebase emulators (functions + firestore + storage), run by `npm run emulador`.
// Method first (the coleta mínima needs a published version): publicarMetodo and leMetodo.
// Reception: a valid ficha, the honeypot, an invalid ficha, an origin not allowed and the per-e-mail limit.
// Pipeline from the creation of the ficha (simulated model and providers): coleta mínima → qualificar →
// graduar (triagem) → the rest of the collection → sintetizar → verificar (simulated synthesis and reviewer) –
// Priorizar to analise_pronta, an analysis with a pending issue, a human edit (code checks only), a re-run of
// empresa_registro that yields v2, Declinar to resposta_breve, spam to descartada, autoAnalisar off kept in
// qualificada.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { leMetodo } from '../lib/metodo.js';
import { ARQUIVOS_METODO } from '../lib/metodoArquivos.js';

const PROJETO = 'gmdb-qualidade';
// The in-process admin app must talk to the emulators, never to the real project.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';
const FUNCAO = `http://127.0.0.1:5001/${PROJETO}/southamerica-east1/receberFicha`;
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJETO}/databases/(default)/documents`;
const ORIGEM = 'http://localhost:4321';
const DIA_MS = 24 * 60 * 60 * 1000;

const envia = (corpo, origem = ORIGEM) =>
  fetch(FUNCAO, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origem }, body: JSON.stringify(corpo) });
// Emulator REST reads and writes with the owner token bypass the security rules.
const le = (caminho) => fetch(`${FIRESTORE}/${caminho}`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json());
const lista = async (caminho) => (await le(caminho)).documents ?? [];
const grava = (caminho, campos) =>
  fetch(`${FIRESTORE}/${caminho}?${Object.keys(campos).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: campos }),
  });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until the ficha satisfies the condition (or has an error).
async function ate(id, condicao, limite = 160) {
  let f;
  for (let i = 0; i < limite; i++) {
    f = (await le(`fichas/${id}`)).fields;
    if (f?.erro?.mapValue) throw new Error(`ficha ${id}: ${JSON.stringify(f.erro.mapValue)}`);
    if (f && condicao(f)) return f;
    await espera(250);
  }
  throw new Error(`ficha ${id} did not reach the expected state (estado ${f?.estado?.stringValue})`);
}
const estado = (e) => (f) => f.estado?.stringValue === e;
const eventos = async (id) => (await lista(`fichas/${id}/eventos`)).map((e) => e.fields);
const dias = (f) => (Date.parse(f.expurgoEm.timestampValue) - Date.parse(f.recebidaEm.timestampValue)) / DIA_MS;
const mapa = (v) => v.mapValue.fields;

before(async () => {
  // More than 5 fichas come from the same IP here: raise the per-IP limit for the run (per-e-mail stays at 3).
  assert.equal((await grava('config/pipeline', { limiteFichasPorIpPorHora: { integerValue: '50' } })).status, 200);
});

const valida = { nome: 'Teste', empresa: 'ACME', cargo: 'ceo', email: 'teste@acme.com.br', site: 'acme.com.br', mensagem: '', lang: 'pt-BR', pagina: '/contato' };
// A company the simulated coleta mínima treats as identified, medium size (see coleta/motor.ts, simulaCodigo).
const media = { ...valida, empresa: 'ACME Média Indústria', mensagem: 'Queremos sair das planilhas com apoio de um conselho.', pagina: '/servicos/conselho-de-ia' };

test('publicarMetodo: files stored, config/metodo written; leMetodo returns the fixed order and the chosen sections', { timeout: 30_000 }, async () => {
  const raiz = new URL('../../metodo/', import.meta.url);
  const arquivos = [...ARQUIVOS_METODO].reverse().map((nome) => ({ nome, conteudo: readFileSync(new URL(nome, raiz), 'utf8') }));
  const res = await fetch(`http://127.0.0.1:5001/${PROJETO}/southamerica-east1/publicarMetodo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versao: 'abc1234', arquivos }),
  });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.caminhoStorage, `gs://${PROJETO}-metodo/metodo/abc1234/`);
  const cfg = (await le('config/metodo')).fields;
  assert.equal(cfg.versao.stringValue, 'abc1234');
  assert.equal(Object.keys(cfg.arquivos.mapValue.fields).length, 5);
  const bytes = Number(cfg.arquivos.mapValue.fields['livro-selecao.md'].mapValue.fields.bytes.integerValue);
  assert.equal(bytes, readFileSync(new URL('livro-selecao.md', raiz)).length);

  // In-process admin app against the emulators; deleted at the end so the test runner can exit.
  const app = initializeApp({ projectId: PROJETO });
  let m;
  try {
    m = await leMetodo({ 'mapa-alavancas.md': [1, 2, 3, 4], 'glossario.md': 'tudo' });
  } finally {
    await deleteApp(app);
  }
  assert.equal(m.versao, 'abc1234');
  assert.deepEqual(m.blocos.map((b) => b.nome), ['glossario.md', 'mapa-alavancas.md']);
  assert.equal(m.blocos[0].texto, readFileSync(new URL('glossario.md', raiz), 'utf8'));
  assert.doesNotMatch(m.blocos[1].texto, /^## 5\. /m);
});

test('publicarMetodo: refuses an incomplete set of files', async () => {
  const res = await fetch(`http://127.0.0.1:5001/${PROJETO}/southamerica-east1/publicarMetodo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versao: 'abc1234', arquivos: [{ nome: 'glossario.md', conteudo: 'x' }] }),
  });
  assert.equal(res.status, 400);
});

test('valid ficha: 201, stored with the recebida event and expurgoEm = recebidaEm + 90 days', async () => {
  const res = await envia(valida);
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const f = (await le(`fichas/${id}`)).fields;
  assert.equal(f.original.mapValue.fields.site.stringValue, 'acme.com.br');
  assert.equal(f.normalizado.mapValue.fields.site.stringValue, 'https://acme.com.br');
  assert.equal(f.origem.mapValue.fields.pagina.stringValue, '/contato');
  assert.match(f.origem.mapValue.fields.ip.stringValue, /^[0-9a-f]{64}$/);
  assert.equal(dias(f), 90);
  assert.ok((await eventos(id)).some((e) => e.tipo.stringValue === 'recebida'));
});

let idPriorizar;

test('Priorizar: coleta mínima → qualificar → triagem → rest of the collection → synthesis → verification → analise_pronta', { timeout: 90_000 }, async () => {
  const { id } = await (await envia({ ...media, email: 'p1@acme.com.br' })).json();
  idPriorizar = id;
  const f = await ate(id, estado('analise_pronta'), 360);
  assert.equal(f.versaoMetodo.stringValue, 'abc1234');
  const q = mapa(f.qualificacao);
  assert.equal(q.decisao.stringValue, 'prosseguir');
  assert.equal(q.nivelCargo.stringValue, 'decisor');
  assert.equal(q.dominioCorporativo.booleanValue, true);
  assert.equal(q.siteResolvido.stringValue, 'https://acme.com.br');
  assert.equal(mapa(q.estruturaTecnologia).categoria.stringValue, 'enxuta');
  assert.equal(mapa(q.portaIndicada).porta.stringValue, 'conselho');
  const todos = await eventos(id);
  const triada = mapa(todos.find((e) => e.tipo.stringValue === 'triada').detalhe);
  assert.equal(triada.quadrante.stringValue, 'priorizar');
  assert.equal(triada.destino.stringValue, 'convidar');
  // The analysis replaces the triagem in lead.
  const l = mapa(f.lead);
  assert.equal(l.momento.stringValue, 'analise');
  assert.equal(l.quadrante.stringValue, 'priorizar');
  assert.equal(l.destino.stringValue, 'convidar');
  assert.equal(Number(mapa(mapa(l.eixos).aderencia).pontos.integerValue), 30);
  assert.equal(Number(mapa(mapa(l.eixos).intencao).pontos.integerValue), 20);
  assert.equal(Number(mapa(mapa(l.eixos).clareza).pontos.integerValue), 20);
  assert.ok(mapa(l.acao).prazoEm.timestampValue); // deadline from the moment the analysis is ready
  assert.equal(mapa(l.modificadores).escopo.stringValue, 'aprovado');
  assert.equal(mapa(l.modificadores).confianca.stringValue, 'baixa'); // simulated blocks have low confidence
  assert.equal(mapa(l.modificadores).confiancaMotivo.stringValue, 'Registro, Presença digital e Pessoas com confiança baixa');
  assert.equal(mapa(mapa(mapa(l.eixos).aderencia).porte).fonteFuncionarios.stringValue, 'apollo');
  assert.equal(dias(f), 90);
  assert.equal(f.analiseAtual.stringValue, 'v1');
  const etapas = await lista(`fichas/${id}/coleta`);
  assert.equal(etapas.length, 6);
  const digital = etapas.find((e) => e.fields.etapa.stringValue === 'empresa_digital').fields;
  assert.deepEqual(digital.paginasLidas.arrayValue.values.map((v) => v.stringValue), ['https://acme.com.br/']);
  for (const e of etapas) {
    assert.equal(e.fields.status.stringValue, 'concluida', e.fields.etapa.stringValue);
    assert.equal(e.fields.versaoMetodo.stringValue, 'abc1234');
    assert.equal(Number(e.fields.tentativa.integerValue), 1);
  }
  const tipos = todos.map((e) => e.tipo.stringValue);
  for (const t of ['coleta_minima', 'qualificada', 'triada', 'coleta_iniciada', 'graduada', 'sintese', 'verificacao']) assert.equal(tipos.filter((x) => x === t).length, 1, t);
  assert.equal(tipos.filter((x) => x === 'coleta_etapa').length, 6);
  const a = (await le(`fichas/${id}/analise/v1`)).fields;
  assert.deepEqual(Object.keys(mapa(a.secoes)).sort(), ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
  assert.match(mapa(mapa(a.secoes).s0).corpo.stringValue, /\*\*Quadrante:\*\* Priorizar · \*\*Grau:\*\* [A-D]/);
  assert.equal(mapa(a.autor).tipo.stringValue, 'ia');
  assert.equal(a.baseadaEm.nullValue, null);
  assert.equal(mapa(a.enquadramento).portaProvavel.stringValue, 'conselho');
  assert.ok(mapa(a.rascunhoResposta).corpo.stringValue);
  assert.ok(mapa(a.conversa).perguntas.arrayValue.values.length);
  const v = mapa(a.verificacao);
  assert.equal(v.status.stringValue, 'pronta');
  assert.equal(v.modeloRevisor.stringValue, 'simulado');
  assert.equal(v.pendencias.arrayValue.values, undefined); // empty list
  // uso per call (spec 01 v0.11): the three synthesis calls, the reviewer and the total.
  const u = mapa(a.uso);
  assert.deepEqual(Object.keys(u).sort(), ['enquadrar', 'montar_analise', 'preparar_conversa', 'revisor', 'total']);
  assert.equal(mapa(u.revisor).modelo.stringValue, 'simulado');
  assert.ok('cacheLidos' in mapa(u.total));
});

test('analysis with a pending issue: analise_com_pendencias, medium-level reason added to the confidence', { timeout: 90_000 }, async () => {
  const { id } = await (await envia({ ...media, email: 'p3@acme.com.br', mensagem: 'Queremos sair das planilhas com um conselho; teste de pendência.' })).json();
  const f = await ate(id, estado('analise_com_pendencias'), 360);
  const m = mapa(mapa(f.lead).modificadores);
  assert.equal(m.confiancaMotivo.stringValue, 'Registro, Presença digital e Pessoas com confiança baixa · análise com pendências');
  const v = mapa((await le(`fichas/${id}/analise/v1`)).fields.verificacao);
  assert.equal(v.status.stringValue, 'com_pendencias');
  const p = v.pendencias.arrayValue.values.map((x) => mapa(x));
  assert.deepEqual(p.map((x) => [x.tipo.stringValue, x.secao.stringValue, x.regra.stringValue]), [['mecanica', 's3', 'tipografia']]);
  assert.equal(p[0].correcaoSugerida.nullValue, null);
});

test('repair: concrete times and no name in the draft are fixed by one repair call; the version keeps the fix', { timeout: 90_000 }, async () => {
  const { id } = await (await envia({ ...media, email: 'p4@acme.com.br', mensagem: 'Queremos sair das planilhas com um conselho; teste de reparo.' })).json();
  await ate(id, estado('analise_pronta'), 360);
  const a = (await le(`fichas/${id}/analise/v1`)).fields;
  const corpo = mapa(a.rascunhoResposta).corpo.stringValue;
  assert.match(corpo, /^Olá, \S+,/);
  assert.match(corpo, /\[opção de horário 1\] ou na quinta às|\[opção de horário 1\]/);
  assert.doesNotMatch(corpo, /às 10h/);
  const v = mapa(a.verificacao);
  assert.equal(v.pendencias.arrayValue.values, undefined);
  const reparos = v.reparos.arrayValue.values.map((x) => mapa(x));
  assert.deepEqual(reparos.map((r) => [r.etapa.stringValue, r.regra.stringValue, r.aceito.booleanValue]).sort(), [
    ['preparar_conversa', 'rascunho_horario_concreto', true], ['preparar_conversa', 'rascunho_sem_nome', true],
  ]);
  assert.equal(mapa(a.uso).reparar.arrayValue.values.length, 1);
});

test('human edit: v2 by a person gets only the code checks; state, confidence and deadline kept', { timeout: 60_000 }, async () => {
  const app = initializeApp({ projectId: PROJETO }, 'edicao');
  try {
    const db = getFirestore(app);
    const ref = db.collection('fichas').doc(idPriorizar);
    const antes = (await ref.get()).data();
    const v1 = (await ref.collection('analise').doc('v1').get()).data();
    await ref.update({ analiseAtual: 'v2' });
    const s3 = { ...v1.secoes.s3, corpo: `${v1.secoes.s3.corpo} Trecho editado \u2014 com travessão.` };
    await ref.collection('analise').doc('v2').create({ ...v1, verificacao: null, autor: { tipo: 'humano', id: 'teste' }, baseadaEm: 'v1', secoes: { ...v1.secoes, s3 }, criadaEm: Timestamp.now() });
    let v2;
    for (let i = 0; i < 120 && !v2?.verificacao; i++) {
      await espera(250);
      v2 = (await ref.collection('analise').doc('v2').get()).data();
    }
    assert.equal(v2.verificacao.status, 'com_pendencias');
    assert.equal(v2.verificacao.modeloRevisor, null);
    assert.deepEqual(v2.verificacao.pendencias.map((x) => [x.tipo, x.secao, x.regra, x.correcaoSugerida]), [['mecanica', 's3', 'tipografia', null]]);
    assert.ok(v2.secoes.s3.corpo.includes(v2.verificacao.pendencias[0].trecho));
    const depois = (await ref.get()).data();
    assert.equal(depois.estado, 'analise_pronta');
    assert.ok(depois.lead.acao.prazoEm.isEqual(antes.lead.acao.prazoEm));
    assert.deepEqual(depois.lead.modificadores, antes.lead.modificadores);
  } finally {
    await deleteApp(app);
  }
});

test('re-run of empresa_registro: only that stage runs again, with its own budget, and a new synthesis (v3)', { timeout: 90_000 }, async () => {
  assert.equal((await grava(`fichas/${idPriorizar}/coleta/empresa_registro`, { status: { stringValue: 'pendente' } })).status, 200);
  assert.equal((await grava(`fichas/${idPriorizar}`, { estado: { stringValue: 'coletando' }, estadoEm: { timestampValue: new Date().toISOString() } })).status, 200);
  await espera(500);
  const f = await ate(idPriorizar, (x) => estado('analise_pronta')(x) && x.analiseAtual?.stringValue === 'v3', 360);
  assert.equal(mapa(mapa(f.lead).modificadores).confiancaMotivo.stringValue, 'Registro, Presença digital e Pessoas com confiança baixa');
  const etapas = Object.fromEntries((await lista(`fichas/${idPriorizar}/coleta`)).map((e) => [e.fields.etapa.stringValue, e.fields]));
  assert.equal(Number(etapas.empresa_registro.tentativa.integerValue), 2);
  for (const e of ['empresa_digital', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado']) assert.equal(Number(etapas[e].tentativa.integerValue), 1, e);
  const iniciadas = (await eventos(idPriorizar)).filter((e) => e.tipo.stringValue === 'coleta_iniciada').map((e) => mapa(e.detalhe));
  assert.deepEqual(iniciadas.map((d) => d.passagem.stringValue).sort(), ['primeira', 'reexecucao']);
  const v3 = (await le(`fichas/${idPriorizar}/analise/v3`)).fields;
  assert.equal(v3.baseadaEm.stringValue, 'v2');
  assert.equal(mapa(v3.verificacao).status.stringValue, 'pronta');
});

test('Declinar: free e-mail, no site, no message → resposta_breve, 30-day retention, deadline from recebidaEm', { timeout: 60_000 }, async () => {
  const { id } = await (await envia({ ...valida, cargo: 'manager', email: 'd1@gmail.com', site: '' })).json();
  const f = await ate(id, estado('resposta_breve'));
  const l = mapa(f.lead);
  assert.equal(l.quadrante.stringValue, 'declinar');
  assert.equal(l.destino.stringValue, 'encerrar');
  assert.equal(l.grau.stringValue, 'D');
  assert.equal(mapa(mapa(mapa(l.eixos).aderencia).porte).categoria.stringValue, 'nenhuma_empresa');
  assert.ok(mapa(l.acao).prazoEm.timestampValue);
  assert.equal(dias(f), 30);
  const minima = await lista(`fichas/${id}/coleta`);
  assert.equal(minima.length, 2); // only the coleta mínima
  assert.equal(minima.find((e) => e.fields.etapa.stringValue === 'empresa_digital').fields.paginasLidas.arrayValue.values, undefined); // empty list
});

test('spam: descartada, quadrant still computed, 30-day retention, metrics', { timeout: 60_000 }, async () => {
  const { id } = await (await envia({ ...valida, email: 's1@acme.com.br', mensagem: 'isto é spam' })).json();
  const f = await ate(id, estado('descartada'));
  assert.equal(mapa(f.qualificacao).decisao.stringValue, 'descartar');
  const l = mapa(f.lead);
  assert.equal(mapa(l.modificadores).spam.booleanValue, true);
  assert.ok(l.quadrante.stringValue);
  assert.equal(mapa(l.acao).prazoEm.nullValue, null);
  assert.equal(dias(f), 30);
  const meses = await lista('metricas');
  assert.ok(meses.some((m) => Number(mapa(m.fields.qualificacao).descartar?.integerValue) >= 1));
  assert.ok(meses.some((m) => m.fields.triagem && Object.keys(mapa(mapa(m.fields.triagem).quadrante)).length >= 1));
});

test('autoAnalisar off: a ficha sent to analysis by the triagem stays in qualificada', { timeout: 60_000 }, async () => {
  assert.equal((await grava('config/pipeline', { autoAnalisar: { booleanValue: false } })).status, 200);
  try {
    const { id } = await (await envia({ ...media, email: 'p2@acme.com.br' })).json();
    const f = await ate(id, (x) => estado('qualificada')(x) && x.lead);
    assert.equal(mapa(f.lead).quadrante.stringValue, 'priorizar');
    await espera(1500);
    assert.equal((await le(`fichas/${id}`)).fields.estado.stringValue, 'qualificada');
    assert.equal((await lista(`fichas/${id}/coleta`)).length, 2);
  } finally {
    await grava('config/pipeline', { autoAnalisar: { booleanValue: true } });
  }
});

test('honeypot: 200 and nothing stored', async () => {
  const antes = (await lista('fichas')).length;
  const res = await envia({ ...valida, email: 'robo@acme.com.br', 'empresa-site': 'x' });
  assert.equal(res.status, 200);
  assert.equal((await lista('fichas')).length, antes);
});

test('invalid ficha: 400 with the fields', async () => {
  const res = await envia({ ...valida, email: 'x', cargo: '' });
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).erros, ['cargo', 'email']);
});

test('origin not allowed: 403', async () => {
  const res = await envia(valida, 'https://x.example');
  assert.equal(res.status, 403);
});

test('above the per-e-mail limit (3 per day): 429', async () => {
  const outro = { ...valida, email: 'Limite@acme.com.br' };
  for (let i = 0; i < 3; i++) assert.equal((await envia(outro)).status, 201);
  // Same address in another case still counts (normalized e-mail).
  assert.equal((await envia({ ...outro, email: 'limite@ACME.com.br' })).status, 429);
});
