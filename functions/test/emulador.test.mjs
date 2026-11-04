// End-to-end test against the Firebase emulators (functions + firestore), run by `npm run emulador`.
// Cases: a valid ficha, the honeypot, an invalid ficha and a ficha above the per-e-mail limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const valida = { nome: 'Teste', empresa: 'ACME', cargo: 'ceo', email: 'teste@acme.com.br', site: 'acme.com.br', mensagem: '', lang: 'pt-BR', pagina: '/contato' };

test('valid ficha: 201, stored in state recebida with event and expurgoEm = recebidaEm + 90 days', async () => {
  const res = await envia(valida);
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const f = (await le(`fichas/${id}`)).fields;
  assert.equal(f.estado.stringValue, 'recebida');
  assert.equal(f.original.mapValue.fields.site.stringValue, 'acme.com.br');
  assert.equal(f.normalizado.mapValue.fields.site.stringValue, 'https://acme.com.br');
  assert.equal(f.origem.mapValue.fields.pagina.stringValue, '/contato');
  assert.match(f.origem.mapValue.fields.ip.stringValue, /^[0-9a-f]{64}$/);
  const dias = (Date.parse(f.expurgoEm.timestampValue) - Date.parse(f.recebidaEm.timestampValue)) / DIA_MS;
  assert.equal(dias, 90);
  const eventos = await lista(`fichas/${id}/eventos`);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].fields.tipo.stringValue, 'recebida');
  assert.equal(f.erro.nullValue, null);
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
