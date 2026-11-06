// Test fichas for the collection (phase 3): written straight into Firestore, never through the form,
// so no e-mail is sent. Names and e-mails are invented; companies are real (domain from the file).
// Usage (from functions/, in Cloud Shell): npm run fichas-teste -- gmdb-qualidade test/fichas-teste.json
// The file is a JSON list of {nome, empresa, cargo, email, site, mensagem}; test/fichas-teste.json holds
// the phase 3 sample (invented names and e-mails; a fictitious company on a reserved .example domain).
// Re-run: npm run fichas-teste -- gmdb-qualidade --reexecutar moves the test fichas in "coletada" back
// to "coletando"; stages already "concluida" with the same method version are skipped, failed ones run again.
// Options of the re-run: --etapas=empresa_registro,empresa_pessoas also runs these stages again even if
// concluded; --uma-por-vez runs one ficha at a time (no burst of calls to the same provider). The cost
// printed for a re-run is the cost of that re-run only.
// Steps: create the fichas (qualificar runs on creation), wait for the qualification, move the
// "analisar" ones to "coletando", wait for "coletada" and print a report per stage (no personal data).
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { valida } from '../lib/validacao.js';

const ETAPAS = ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado'];
const opcoes = process.argv.slice(2).filter((a) => a.startsWith('--') && a !== '--reexecutar');
const [projeto, arquivo] = process.argv.slice(2).filter((a) => !opcoes.includes(a));
const umaPorVez = opcoes.includes('--uma-por-vez');
const forcar = (opcoes.find((a) => a.startsWith('--etapas=')) ?? '--etapas=').slice(9).split(',').filter(Boolean);
const invalidas = forcar.filter((e) => !ETAPAS.includes(e));
if (invalidas.length || opcoes.some((a) => a !== '--uma-por-vez' && !a.startsWith('--etapas='))) {
  console.error(`Unknown option or stage: ${[...invalidas, ...opcoes].join(' ')}`);
  process.exit(1);
}
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

const reexecutar = arquivo === '--reexecutar';
const entradas = reexecutar ? [] : JSON.parse(readFileSync(arquivo, 'utf8'));
const criadas = [];
if (reexecutar) {
  const q = await db.collection('fichas').where('teste', '==', true).where('estado', '==', 'coletada').get();
  for (const d of q.docs) {
    criadas.push({ empresa: d.get('original.empresa'), ref: d.ref, decisao: 'analisar', reexecucao: true });
    console.log(`re-run ${d.id} – ${d.get('original.empresa')}`);
  }
}
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

for (const c of criadas.filter((x) => !x.reexecucao)) {
  const d = await ate(c.ref, (x) => x?.qualificacao || x?.erro, 120_000);
  c.decisao = d?.qualificacao?.decisao ?? `erro: ${d?.erro?.mensagem ?? 'timeout'}`;
  if (d?.estado === 'qualificada' && d.qualificacao.decisao === 'analisar') await c.ref.update({ estado: 'coletando', estadoEm: Timestamp.now() });
  console.log(`${c.ref.id} – ${c.empresa}: ${c.decisao} (${d?.estado})`);
}

// Moves a re-run ficha to "coletando", after marking the forced stages as pending.
async function reabre(c) {
  for (const etapa of forcar) await c.ref.collection('coleta').doc(etapa).set({ status: 'pendente' }, { merge: true });
  c.usdAntes = (await c.ref.get()).get('custo.usdEstimado') ?? 0;
  await c.ref.update({ estado: 'coletando', estadoEm: Timestamp.now() });
}

async function relata(c) {
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
  const usd = (d?.custo?.usdEstimado ?? 0) - (c.usdAntes ?? 0);
  console.log(`  custo ${c.reexecucao ? 'desta reexecução' : 'da ficha'}: US$ ${usd.toFixed(4)} – buscas da ficha ${d?.custo?.buscas ?? 0}`);
  return usd;
}

let total = 0;
const analisar = criadas.filter((c) => c.decisao === 'analisar');
if (umaPorVez) {
  for (const c of analisar) {
    if (c.reexecucao) await reabre(c);
    total += await relata(c);
  }
} else {
  for (const c of analisar) if (c.reexecucao) await reabre(c);
  for (const c of analisar) total += await relata(c);
}
console.log(`\ncusto total: US$ ${total.toFixed(4)}`);
