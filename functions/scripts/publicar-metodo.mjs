// Publishes metodo/ through the private publicarMetodo function (spec 01: config/metodo).
// Usage (from functions/, in Cloud Shell, with gcloud logged in): npm run publicar-metodo -- gmdb-qualidade
// Refuses uncommitted changes in metodo/; the version is the short hash of the last commit that touched it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARQUIVOS_METODO, exigeLimpo, versaoValida } from '../lib/metodoArquivos.js';

const projeto = process.argv[2];
if (!projeto) {
  console.error('Usage: npm run publicar-metodo -- <project id>');
  process.exit(1);
}
const raiz = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args) => execFileSync('git', ['-C', raiz, ...args], { encoding: 'utf8' });

exigeLimpo(git('status', '--porcelain', '--', 'metodo'));
const versao = git('log', '-1', '--format=%h', '--', 'metodo').trim();
if (!versaoValida(versao)) throw new Error('No commit touches metodo/');

const arquivos = ARQUIVOS_METODO.map((nome) => ({ nome, conteudo: readFileSync(`${raiz}metodo/${nome}`, 'utf8') }));
// Caller's Google identity; the token is used in the request only, never printed.
const token = execFileSync('gcloud', ['auth', 'print-identity-token'], { encoding: 'utf8' }).trim();
const url = `https://southamerica-east1-${projeto}.cloudfunctions.net/publicarMetodo`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ versao, arquivos }),
});
const r = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`publicarMetodo HTTP ${res.status}: ${r?.motivo ?? 'no body'}`);
  process.exit(1);
}
console.log(`versao ${r.versao} – ${r.caminhoStorage} – tokens counted with ${r.modelo}`);
for (const [nome, a] of Object.entries(r.arquivos)) console.log(`${nome.padEnd(20)} ${String(a.bytes).padStart(7)} bytes ${String(a.tokensEstimados).padStart(7)} tokens  ${a.sha256.slice(0, 12)}`);
console.log(`total ${r.total} tokens (spec 02 estimate: 40000)`);
