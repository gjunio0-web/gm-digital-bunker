// End-to-end test against the Firebase emulators (functions + firestore), run by `npm run emulador`.
// Reception: a valid ficha, the honeypot, an invalid ficha, an origin not allowed and the per-e-mail limit.
// Qualification (the trigger runs with the simulated model): analisar, responder_breve and descartar.
// Method: publicarMetodo stores the files and config/metodo; leMetodo reads them back in the fixed order.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { leMetodo } from '../lib/metodo.js';
import { ARQUIVOS_METODO } from '../lib/metodoArquivos.js';

const PROJETO = 'gmdb-qualidade';
const FUNCAO = `http://127.0.0.1:5001/${PROJETO}/southamerica-east1/receberFicha`;
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJETO}/databases/(default)/documents`;
const ORIGEM = 'http://localhost:4321';
const DIA_MS = 24 * 60 * 60 * 1000;

const envia = (corpo, origem = ORIGEM) =>
  fetch(FUNCAO, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origem }, body: JSON.stringify(corpo) });
// Emulator REST reads with the owner token bypass the security rules.
const le = (caminho) => fetch(`${FIRESTORE}/${caminho}`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json());
const lista = async (caminho) => (await le(caminho)).documents ?? [];

// More than 5 fichas come from the same IP here: raise the per-IP limit for the run (per-e-mail stays at 3).
before(async () => {
  const r = await fetch(`${FIRESTORE}/config/pipeline?updateMask.fieldPaths=limiteFichasPorIpPorHora`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { limiteFichasPorIpPorHora: { integerValue: '50' } } }),
  });
  assert.equal(r.status, 200);
});

const valida = { nome: 'Teste', empresa: 'ACME', cargo: 'ceo', email: 'teste@acme.com.br', site: 'acme.com.br', mensagem: '', lang: 'pt-BR', pagina: '/contato' };

// Waits until the qualificar trigger has written the ficha.
const qualificada = async (id) => {
  for (let i = 0; i < 40; i++) {
    const f = (await le(`fichas/${id}`)).fields;
    if (f?.qualificacao || f?.erro?.mapValue) return f;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`ficha ${id} not qualified`);
};
const evento = async (id, tipo) => (await lista(`fichas/${id}/eventos`)).find((e) => e.fields.tipo.stringValue === tipo);

test('valid ficha: 201, stored with the recebida event and expurgoEm = recebidaEm + 90 days', async () => {
  const res = await envia(valida);
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const f = (await le(`fichas/${id}`)).fields;
  assert.equal(f.original.mapValue.fields.site.stringValue, 'acme.com.br');
  assert.equal(f.normalizado.mapValue.fields.site.stringValue, 'https://acme.com.br');
  assert.equal(f.origem.mapValue.fields.pagina.stringValue, '/contato');
  assert.match(f.origem.mapValue.fields.ip.stringValue, /^[0-9a-f]{64}$/);
  const dias = (Date.parse(f.expurgoEm.timestampValue) - Date.parse(f.recebidaEm.timestampValue)) / DIA_MS;
  assert.equal(dias, 90);
  assert.ok(await evento(id, 'recebida'));
  assert.equal(f.erro.nullValue, null);
});

test('qualificar: corporate e-mail, no message, decision role: analisar, coletando (autoAnalisar default)', async () => {
  const { id } = await (await envia({ ...valida, email: 'q1@acme.com.br' })).json();
  const f = await qualificada(id);
  const q = f.qualificacao.mapValue.fields;
  assert.equal(q.decisao.stringValue, 'analisar');
  assert.equal(q.dominioCorporativo.booleanValue, true);
  assert.equal(q.cargoDecisor.booleanValue, true);
  assert.equal(q.siteResolvido.stringValue, 'https://acme.com.br');
  assert.equal(q.classificacaoMensagem.nullValue, null);
  assert.equal(f.estado.stringValue, 'coletando');
  const dias = (Date.parse(f.expurgoEm.timestampValue) - Date.parse(f.recebidaEm.timestampValue)) / DIA_MS;
  assert.equal(dias, 90);
  assert.equal((await evento(id, 'qualificada')).fields.detalhe.mapValue.fields.decisao.stringValue, 'analisar');
});

test('qualificar: free e-mail without message: resposta_breve, expurgoEm = recebidaEm + 30 days', async () => {
  const { id } = await (await envia({ ...valida, email: 'q2@gmail.com', site: '' })).json();
  const f = await qualificada(id);
  assert.equal(f.qualificacao.mapValue.fields.decisao.stringValue, 'responder_breve');
  assert.equal(f.estado.stringValue, 'resposta_breve');
  const dias = (Date.parse(f.expurgoEm.timestampValue) - Date.parse(f.recebidaEm.timestampValue)) / DIA_MS;
  assert.equal(dias, 30);
});

test('qualificar: message classified as spam (simulated model): descartada, metricas incremented', async () => {
  const { id } = await (await envia({ ...valida, email: 'q3@acme.com.br', mensagem: 'isto é spam' })).json();
  const f = await qualificada(id);
  const q = f.qualificacao.mapValue.fields;
  assert.equal(q.decisao.stringValue, 'descartar');
  assert.equal(q.classificacaoMensagem.mapValue.fields.tipoContato.stringValue, 'spam');
  assert.equal(f.estado.stringValue, 'descartada');
  const meses = await lista('metricas');
  assert.ok(meses.some((m) => Number(m.fields.qualificacao.mapValue.fields.descartar?.integerValue) >= 1));
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

test('publicarMetodo: files stored, config/metodo written; leMetodo returns the fixed order and the chosen sections', async () => {
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

  initializeApp({ projectId: PROJETO });
  const m = await leMetodo({ 'mapa-alavancas.md': [1, 2, 3, 4], 'glossario.md': 'tudo' });
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
