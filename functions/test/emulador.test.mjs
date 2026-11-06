// End-to-end test against the Firebase emulators (functions + firestore + storage), run by `npm run emulador`.
// Method first (the coleta mínima needs a published version): publicarMetodo and leMetodo.
// Reception: a valid ficha, the honeypot, an invalid ficha, an origin not allowed and the per-e-mail limit.
// Pipeline from the creation of the ficha (simulated model and providers): coleta mínima → qualificar →
// graduar (triagem) → the rest of the collection – Priorizar to coletada, Declinar to resposta_breve,
// spam to descartada, autoAnalisar off kept in qualificada, and a re-run of empresa_registro.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deleteApp, initializeApp } from 'firebase-admin/app';
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

test('Priorizar: coleta mínima → qualificar → triagem → rest of the collection → coletada', { timeout: 90_000 }, async () => {
  const { id } = await (await envia({ ...media, email: 'p1@acme.com.br' })).json();
  idPriorizar = id;
  const f = await ate(id, estado('coletada'), 320);
  assert.equal(f.versaoMetodo.stringValue, 'abc1234');
  const q = mapa(f.qualificacao);
  assert.equal(q.decisao.stringValue, 'prosseguir');
  assert.equal(q.nivelCargo.stringValue, 'decisor');
  assert.equal(q.dominioCorporativo.booleanValue, true);
  assert.equal(q.siteResolvido.stringValue, 'https://acme.com.br');
  assert.equal(mapa(q.estruturaTecnologia).categoria.stringValue, 'enxuta');
  assert.equal(mapa(q.portaIndicada).porta.stringValue, 'conselho');
  const l = mapa(f.lead);
  assert.equal(l.momento.stringValue, 'triagem');
  assert.equal(l.quadrante.stringValue, 'priorizar');
  assert.equal(l.destino.stringValue, 'convidar');
  assert.equal(Number(mapa(mapa(l.eixos).aderencia).pontos.integerValue), 30);
  assert.equal(Number(mapa(mapa(l.eixos).intencao).pontos.integerValue), 20);
  assert.equal(mapa(l.acao).prazoEm.nullValue, null); // deadline after the analysis
  assert.equal(mapa(l.modificadores).confianca.stringValue, 'baixa'); // simulated blocks have low confidence
  assert.equal(dias(f), 90);
  const etapas = await lista(`fichas/${id}/coleta`);
  assert.equal(etapas.length, 6);
  for (const e of etapas) {
    assert.equal(e.fields.status.stringValue, 'concluida', e.fields.etapa.stringValue);
    assert.equal(e.fields.versaoMetodo.stringValue, 'abc1234');
    assert.equal(Number(e.fields.tentativa.integerValue), 1);
  }
  const tipos = (await eventos(id)).map((e) => e.tipo.stringValue);
  for (const t of ['coleta_minima', 'qualificada', 'triada', 'coleta_iniciada']) assert.equal(tipos.filter((x) => x === t).length, 1, t);
  assert.equal(tipos.filter((x) => x === 'coleta_etapa').length, 6);
});

test('re-run of empresa_registro: only that stage runs again, with its own budget', { timeout: 60_000 }, async () => {
  assert.equal((await grava(`fichas/${idPriorizar}/coleta/empresa_registro`, { status: { stringValue: 'pendente' } })).status, 200);
  assert.equal((await grava(`fichas/${idPriorizar}`, { estado: { stringValue: 'coletando' }, estadoEm: { timestampValue: new Date().toISOString() } })).status, 200);
  await espera(500);
  await ate(idPriorizar, estado('coletada'), 240);
  const etapas = Object.fromEntries((await lista(`fichas/${idPriorizar}/coleta`)).map((e) => [e.fields.etapa.stringValue, e.fields]));
  assert.equal(Number(etapas.empresa_registro.tentativa.integerValue), 2);
  for (const e of ['empresa_digital', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado']) assert.equal(Number(etapas[e].tentativa.integerValue), 1, e);
  const iniciadas = (await eventos(idPriorizar)).filter((e) => e.tipo.stringValue === 'coleta_iniciada').map((e) => mapa(e.detalhe));
  assert.deepEqual(iniciadas.map((d) => d.passagem.stringValue).sort(), ['primeira', 'reexecucao']);
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
  assert.equal((await lista(`fichas/${id}/coleta`)).length, 2); // only the coleta mínima
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
