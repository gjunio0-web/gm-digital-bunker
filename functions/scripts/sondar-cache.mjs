// Cache probe of phase B2 (item 9.3): calls the private sondarCache function with the caller's Google identity
// and prints the usage of its three calls (no text). Prepared in phase 5; run only when Gon says so.
// Usage (from functions/, in Cloud Shell): npm run sondar-cache -- gmdb-qualidade <fichaId>
// Reading: call 2 with cacheLidos covering the data block → the hypothesis holds (same schema, cache read);
// call 3 reading only the system prefix → the schema breaks the message level; no read at all → another cause.
import { execFileSync } from 'node:child_process';

const [projeto, fichaId] = process.argv.slice(2);
if (!projeto || !fichaId) {
  console.error('Usage: npm run sondar-cache -- <project id> <fichaId>');
  process.exit(1);
}
// Caller's Google identity; the token is used in the request only, never printed.
const token = execFileSync('gcloud', ['auth', 'print-identity-token'], { encoding: 'utf8' }).trim();
const res = await fetch(`https://southamerica-east1-${projeto}.cloudfunctions.net/sondarCache`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fichaId }),
});
const r = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`sondarCache HTTP ${res.status}: ${r?.motivo ?? 'no body'}`);
  process.exit(1);
}
console.log(`modelo ${r.modelo} – método ${r.versaoMetodo}`);
for (const c of r.chamadas) {
  console.log(`chamada ${c.chamada} (${c.esquema}): entrada ${c.tokensEntrada} · cache lido ${c.cacheLidos} · cache gravado ${c.cacheEscritos} · saída ${c.tokensSaida} · ${Math.round(c.duracaoMs / 1000)} s · US$ ${(c.usdEstimado ?? 0).toFixed(4)}${c.fim === 'end_turn' ? '' : ` · ${c.fim}`}`);
}
console.log(`total US$ ${r.chamadas.reduce((t, c) => t + (c.usdEstimado ?? 0), 0).toFixed(4)}`);
