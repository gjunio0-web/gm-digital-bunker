// Claude API consumption recorded by the pipeline in a Firebase project (estimates computed by the code from
// the usage each response returned; the Claude Console is the billing source). Read-only. Prints:
// - metricas/{aaaa-mm}: cost by routine (qualificação, coleta mínima, coleta, síntese, verificação), which
//   survives deleted fichas;
// - fichas: total, count, average per ficha and per day (São Paulo date of recebidaEm);
// - analyses: cost per call (enquadrar, preparar_conversa, montar_analise, revisor) and model, per day of
//   criadaEm; the rest of each ficha's cost (coleta and qualificação) goes to the day of recebidaEm;
// - collection stages: tokens and searches of the last run of each stage (re-runs overwrite the stage
//   document, so this is a share, not a total).
// No personal data: fichas are shown by id only.
// Usage: node scripts/consumo-claude.mjs <project id>
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projeto = process.argv[2];
if (!projeto) {
  console.error('Usage: node scripts/consumo-claude.mjs <project id>');
  process.exit(1);
}
initializeApp({ projectId: projeto });
const db = getFirestore();

const dia = (t) => t.toDate().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const usd = (v) => `US$ ${(v ?? 0).toFixed(4)}`;
const soma = (o, k, v) => { o[k] = (o[k] ?? 0) + (v ?? 0); };

console.log('## metricas (custo por rotina, por mês)');
for (const m of (await db.collection('metricas').get()).docs) {
  const c = m.get('custo') ?? {};
  const linhas = Object.entries(c).map(([rotina, v]) => `${rotina} ${usd(v?.usdEstimado)}`);
  const total = Object.values(c).reduce((t, v) => t + (v?.usdEstimado ?? 0), 0);
  console.log(`${m.id}: ${linhas.join(' · ')} · total ${usd(total)}`);
}

const fichas = (await db.collection('fichas').get()).docs;
let total = 0;
const porDia = {};
const porDiaSintese = {};
const porDiaColeta = {};
const porChamada = {};
const porModelo = {};
const etapas = {};
let nAnalises = 0;
let nComAnalise = 0;
for (const f of fichas) {
  const d = f.data();
  const t = d.custo?.usdEstimado ?? 0;
  total += t;
  let sintese = 0;
  const analises = (await f.ref.collection('analise').get()).docs;
  if (analises.length) nComAnalise++;
  for (const a of analises) {
    const u = a.get('uso') ?? {};
    const modelo = a.get('autor.id') ?? '?';
    const diaA = dia(a.get('criadaEm'));
    nAnalises++;
    for (const [k, v] of Object.entries(u.chamadas ?? {})) {
      soma(porChamada, k, v.usdEstimado);
      soma(porModelo, `${modelo} (síntese)`, v.usdEstimado);
    }
    soma(porChamada, 'revisor', u.revisor?.usdEstimado);
    soma(porModelo, 'claude-sonnet-5-5 (revisor)', u.revisor?.usdEstimado);
    soma(porDiaSintese, diaA, u.usdEstimado);
    sintese += u.usdEstimado ?? 0;
  }
  const resto = t - sintese;
  soma(porDiaColeta, dia(d.recebidaEm), resto);
  for (const e of (await f.ref.collection('coleta').get()).docs) {
    const u = e.get('uso') ?? {};
    const x = (etapas[e.id] ??= { execucoes: 0, tokensEntrada: 0, tokensSaida: 0, buscas: 0 });
    x.execucoes++;
    x.tokensEntrada += u.tokensEntrada ?? 0;
    x.tokensSaida += u.tokensSaida ?? 0;
    x.buscas += u.buscas ?? 0;
  }
  console.log(`ficha ${f.id} ${dia(d.recebidaEm)} ${d.teste ? 'teste' : 'real'} ${d.estado} total ${usd(t)} (análises ${analises.length}: ${usd(sintese)}; coleta e qualificação ${usd(resto)})`);
}
for (const k of new Set([...Object.keys(porDiaSintese), ...Object.keys(porDiaColeta)])) soma(porDia, k, (porDiaSintese[k] ?? 0) + (porDiaColeta[k] ?? 0));

console.log('\n## fichas existentes');
console.log(`fichas ${fichas.length} · com análise ${nComAnalise} · versões de análise ${nAnalises} · total ${usd(total)} · média por ficha ${usd(total / (fichas.length || 1))}`);
console.log('\n## por dia (síntese e revisor pela data da versão; coleta e qualificação pela data de recebimento)');
for (const k of Object.keys(porDia).sort()) console.log(`${k}: ${usd(porDia[k])} (coleta e qualificação ${usd(porDiaColeta[k])}, síntese e revisor ${usd(porDiaSintese[k])})`);
console.log('\n## síntese e verificação por chamada');
for (const [k, v] of Object.entries(porChamada)) console.log(`${k}: ${usd(v)}`);
console.log('\n## síntese e verificação por modelo');
for (const [k, v] of Object.entries(porModelo)) console.log(`${k}: ${usd(v)}`);
console.log('\n## etapas de coleta (última execução de cada etapa, soma das fichas)');
for (const [k, v] of Object.entries(etapas)) console.log(`${k}: execuções ${v.execucoes} · tokens ${v.tokensEntrada}/${v.tokensSaida} · buscas ${v.buscas}`);
