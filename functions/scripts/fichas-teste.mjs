// Test fichas for the collection (phase 3): written straight into Firestore, never through the form,
// so no e-mail is sent. Names and e-mails are invented; companies are real (domain from the file).
// Usage (from functions/, in Cloud Shell): npm run fichas-teste -- gmdb-qualidade test/fichas-teste.json
// The file is a JSON list of {nome, empresa, cargo, email, site, mensagem}; test/fichas-teste.json holds
// the phase 3 sample (invented names and e-mails; a fictitious company on a reserved .example domain).
// Steps: create the fichas (qualificar runs on creation), wait for the qualification, move the
// "analisar" ones to "coletando", wait for "coletada" and print a report per stage (no personal data).
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { valida } from '../lib/validacao.js';

const [projeto, arquivo] = process.argv.slice(2);
if (!projeto || !arquivo) {
  console.error('Usage: npm run fichas-teste -- <project id> <file.json>');
  process.exit(1);
}
initializeApp({ projectId: projeto });
const db = getFirestore();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const DIA_MS = 86_400_000;

async function ate(ref, condicao, limiteMs, passoMs = 3000) {
  const fim = Date.now() + limiteMs;
  for (;;) {
    const d = (await ref.get()).data();
    if (condicao(d) || Date.now() > fim) return d;
    await espera(passoMs);
  }
}

const entradas = JSON.parse(readFileSync(arquivo, 'utf8'));
const criadas = [];
for (const e of entradas) {
  const v = valida({ ...e, lang: 'pt-BR', 'empresa-site': '' });
  if (!v.ok) throw new Error(`invalid test ficha for ${e.empresa}: ${v.erros.join(', ')}`);
  const agora = Timestamp.now();
  const ref = db.collection('fichas').doc();
  await ref.create({
    original: v.original,
    normalizado: v.normalizado,
    recebidaEm: agora,
    origem: { ip: 'script-de-teste', userAgent: 'fichas-teste.mjs', pagina: null },
    estado: 'recebida',
    estadoEm: agora,
    expurgoEm: Timestamp.fromMillis(agora.toMillis() + 90 * DIA_MS),
    erro: null,
    teste: true,
  });
  await ref.collection('eventos').add({ em: agora, ator: { tipo: 'sistema', id: 'fichas-teste' }, tipo: 'recebida', detalhe: {} });
  criadas.push({ empresa: e.empresa, ref });
  console.log(`created ${ref.id} – ${e.empresa}`);
}

for (const c of criadas) {
  const d = await ate(c.ref, (x) => x?.qualificacao || x?.erro, 120_000);
  c.decisao = d?.qualificacao?.decisao ?? `erro: ${d?.erro?.mensagem ?? 'timeout'}`;
  if (d?.estado === 'qualificada' && d.qualificacao.decisao === 'analisar') await c.ref.update({ estado: 'coletando', estadoEm: Timestamp.now() });
  console.log(`${c.ref.id} – ${c.empresa}: ${c.decisao} (${d?.estado})`);
}

let total = 0;
for (const c of criadas) {
  if (c.decisao !== 'analisar') continue;
  const d = await ate(c.ref, (x) => x?.estado === 'coletada' || x?.erro, 600_000, 5000);
  console.log(`\n=== ${c.empresa} (${c.ref.id}) – ${d?.estado}${d?.erro ? ` – erro: ${d.erro.mensagem}` : ''}`);
  const etapas = await c.ref.collection('coleta').get();
  for (const s of etapas.docs) {
    const e = s.data();
    const u = e.uso ?? {};
    const chamadas = ['Brasilapi', 'Apollo', 'Apify', 'Hunter'].map((f) => `${f[0]}${u[`chamadas${f}`] ?? 0}`).join(' ');
    console.log(`  ${e.etapa.padEnd(17)} ${String(e.status).padEnd(9)} conf=${e.confianca?.grau ?? '-'} fontes=${e.fontes?.length ?? 0} buscas=${u.buscas ?? 0} ${chamadas} ${Math.round((u.duracaoMs ?? 0) / 1000)}s`);
    if (e.confianca?.motivo) console.log(`      motivo: ${String(e.confianca.motivo).slice(0, 160)}`);
  }
  const usd = d?.custo?.usdEstimado ?? 0;
  total += usd;
  console.log(`  custo da ficha: US$ ${usd.toFixed(4)} – buscas ${d?.custo?.buscas ?? 0}`);
}
console.log(`\ncusto total: US$ ${total.toFixed(4)}`);
