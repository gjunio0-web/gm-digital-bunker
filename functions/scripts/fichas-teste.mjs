// Test fichas, written straight into Firestore, never through the form, so no e-mail is sent. Names and
// e-mails are invented; companies are real (domain from the file).
// Usage (from functions/, in Cloud Shell): npm run fichas-teste -- gmdb-qualidade test/fichas-teste.json
// The file is a JSON list of {nome, empresa, cargo, email, site, mensagem, pagina}; test/fichas-teste.json
// holds the sample (invented names and e-mails; a fictitious company on a reserved .example domain).
// New fichas go through the pipeline by themselves: coleta mínima, qualificar and graduar (triagem); the
// ones the triagem sends to analysis go on to the rest of the collection when autoAnalisar is on, then to
// the synthesis (sintetizar) and the verification (verificar).
// Re-run: npm run fichas-teste -- gmdb-qualidade --reexecutar re-runs stages of the test fichas in
// "coletada": the failed ones by default, or the stages given in --etapas=empresa_registro,empresa_pessoas
// (any of the six); a new synthesis (v+1) follows by itself. --sintese re-runs only the synthesis of test
// fichas in coletada, sintetizando (stopped by an error), analise_pronta or analise_com_pendencias.
// --ficha=<id>[,<id>…] limits it to those fichas; --uma-por-vez runs one ficha at a time. The cost printed for a
// re-run is the cost of that re-run only. Report without personal data.
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { valida } from '../lib/validacao.js';

const ETAPAS = ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado'];
const opcoes = process.argv.slice(2).filter((a) => a.startsWith('--') && a !== '--reexecutar' && a !== '--sintese');
const [projeto, arquivo] = process.argv.slice(2).filter((a) => !opcoes.includes(a));
const umaPorVez = opcoes.includes('--uma-por-vez');
const soFichas = (opcoes.find((a) => a.startsWith('--ficha=')) ?? '--ficha=').slice(8).split(',').filter(Boolean);
const fora = (id) => soFichas.length > 0 && !soFichas.includes(id);
const forcar = (opcoes.find((a) => a.startsWith('--etapas=')) ?? '--etapas=').slice(9).split(',').filter(Boolean);
const invalidas = forcar.filter((e) => !ETAPAS.includes(e));
if (!projeto || !arquivo || invalidas.length || opcoes.some((a) => a !== '--uma-por-vez' && !a.startsWith('--etapas=') && !a.startsWith('--ficha='))) {
  console.error('Usage: npm run fichas-teste -- <project id> <file.json> | --reexecutar [--etapas=a,b] [--ficha=<id>] [--uma-por-vez] | --sintese [--ficha=<id>] [--uma-por-vez]');
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
const sintese = arquivo === '--sintese';
const fichas = [];
if (sintese) {
  const q = await db.collection('fichas').where('teste', '==', true).where('estado', 'in', ['coletada', 'sintetizando', 'analise_pronta', 'analise_com_pendencias']).get();
  for (const d of q.docs) {
    if (fora(d.id)) continue;
    if (d.get('estado') === 'sintetizando' && !d.get('erro')) continue; // running now
    fichas.push({ empresa: d.get('original.empresa'), ref: d.ref, reexecucao: true, soSintese: true });
    console.log(`synthesis re-run ${d.id} – ${d.get('original.empresa')}`);
  }
} else if (reexecutar) {
  const q = await db.collection('fichas').where('teste', '==', true).where('estado', '==', 'coletada').get();
  for (const d of q.docs) {
    if (fora(d.id)) continue;
    fichas.push({ empresa: d.get('original.empresa'), ref: d.ref, reexecucao: true });
    console.log(`re-run ${d.id} – ${d.get('original.empresa')}`);
  }
} else {
  for (const e of JSON.parse(readFileSync(arquivo, 'utf8'))) {
    const v = valida({ ...e, lang: 'pt-BR', 'empresa-site': '' });
    if (!v.ok) throw new Error(`invalid test ficha for ${e.empresa}: ${v.erros.join(', ')}`);
    const agora = Timestamp.now();
    const ref = db.collection('fichas').doc();
    await ref.create({
      original: v.original,
      normalizado: v.normalizado,
      recebidaEm: agora,
      origem: { ip: 'script-de-teste', userAgent: 'fichas-teste.mjs', pagina: v.pagina },
      estado: 'recebida',
      estadoEm: agora,
      expurgoEm: Timestamp.fromMillis(agora.toMillis() + 90 * DIA_MS),
      erro: null,
      teste: true,
    });
    await ref.collection('eventos').add({ em: agora, ator: { tipo: 'sistema', id: 'fichas-teste' }, tipo: 'recebida', detalhe: {} });
    fichas.push({ empresa: e.empresa, ref });
    console.log(`created ${ref.id} – ${e.empresa}`);
  }
}

// Re-run: marks the chosen stages (or the failed ones) as pending and moves the ficha to "coletando".
// Synthesis only: a ficha in coletada goes through coletando with no stage to run (the move to coletada is
// what starts sintetizar); the others go straight back to coletada.
async function reabre(c) {
  if (c.soSintese) {
    c.usdAntes = (await c.ref.get()).get('custo.usdEstimado') ?? 0;
    c.versaoAntes = (await c.ref.get()).get('analiseAtual') ?? null;
    const atual = (await c.ref.get()).get('estado');
    await c.ref.update({ estado: atual === 'coletada' ? 'coletando' : 'coletada', estadoEm: Timestamp.now(), erro: null });
    console.log(`  ${c.ref.id}: synthesis from ${atual}`);
    return;
  }
  const docs = await c.ref.collection('coleta').get();
  const marcar = forcar.length ? forcar : docs.docs.filter((d) => d.get('status') === 'falhou').map((d) => d.id);
  for (const etapa of marcar) await c.ref.collection('coleta').doc(etapa).set({ status: 'pendente' }, { merge: true });
  c.usdAntes = (await c.ref.get()).get('custo.usdEstimado') ?? 0;
  c.versaoAntes = (await c.ref.get()).get('analiseAtual') ?? null;
  await c.ref.update({ estado: 'coletando', estadoEm: Timestamp.now() });
  console.log(`  ${c.ref.id}: stages ${marcar.join(', ') || '(none)'}`);
}

const pts = (e) => `${e?.pontos ?? '-'}/${e?.maximo ?? '-'}`;

const FINAIS = ['analise_pronta', 'analise_com_pendencias', 'resposta_breve', 'descartada', 'qualificada'];
const linhaLead = (l) => `${l.quadrante} ${l.grau} ${l.pontos} pts – destino ${l.destino} – confiança ${l.modificadores?.confianca}${l.modificadores?.confiancaMotivo ? ` (${l.modificadores.confiancaMotivo})` : ''}${l.modificadores?.spam ? ' – spam' : ''}${l.modificadores?.escopo ? ` – escopo ${l.modificadores.escopo}` : ''}`;

async function relata(c) {
  // Triagem first (new fichas), then the collection, the synthesis and the verification.
  let d = await ate(c.ref, (x) => x?.erro || x?.lead, 300_000, 3000);
  const fim = (x) => x?.erro || (FINAIS.includes(x?.estado) && (!c.reexecucao || x?.analiseAtual !== c.versaoAntes));
  if (!fim(d)) d = await ate(c.ref, fim, 1_200_000, 5000);
  const l = d?.lead;
  console.log(`\n=== ${c.empresa} (${c.ref.id}) – ${d?.estado}${d?.erro ? ` – erro (${d.erro.etapa}): ${d.erro.mensagem}` : ''}`);
  const triada = (await c.ref.collection('eventos').where('tipo', '==', 'triada').get()).docs[0]?.get('detalhe');
  if (triada) console.log(`  triagem: ${triada.quadrante} ${triada.grau} ${triada.pontos} pts – destino ${triada.destino}`);
  if (l) {
    console.log(`  ${l.momento === 'analise' ? 'análise' : 'triagem'} (lead): ${linhaLead(l)}`);
    console.log(`  eixos: aderência ${pts(l.eixos?.aderencia)} (porte ${l.eixos?.aderencia?.porte?.categoria} ${l.eixos?.aderencia?.porte?.pontos}, tecnologia ${l.eixos?.aderencia?.tecnologia?.categoria} ${l.eixos?.aderencia?.tecnologia?.pontos}) – decisão ${pts(l.eixos?.decisao)} – intenção ${pts(l.eixos?.intencao)} – clareza ${pts(l.eixos?.clareza)}${l.deducoes?.length ? ` – deduções ${l.deducoes.map((x) => `${x.risco} ${x.pontos}`).join(', ')}` : ''}`);
    console.log(`  prazo: ${l.acao?.prazoDiasUteis} dias úteis${l.acao?.prazoEm ? ` até ${l.acao.prazoEm.toDate().toISOString().slice(0, 10)}` : ' (após a análise ou sem resposta)'} – expurgo ${d.expurgoEm?.toDate().toISOString().slice(0, 10)}`);
  }
  const etapas = await c.ref.collection('coleta').get();
  for (const s of etapas.docs) {
    const e = s.data();
    const u = e.uso ?? {};
    const chamadas = ['Brasilapi', 'Apollo', 'Apify', 'Hunter'].map((f) => `${f[0]}${u[`chamadas${f}`] ?? 0}`).join(' ');
    console.log(`  ${e.etapa.padEnd(17)} ${String(e.status).padEnd(9)} conf=${e.confianca?.grau ?? '-'} fontes=${e.fontes?.length ?? 0} buscas=${u.buscas ?? 0} ${chamadas} ${Math.round((u.duracaoMs ?? 0) / 1000)}s`);
    if (e.confianca?.motivo) console.log(`      motivo: ${String(e.confianca.motivo).slice(0, 160)}`);
  }
  if (d?.analiseAtual) {
    const a = (await c.ref.collection('analise').doc(d.analiseAtual).get()).data();
    const ps = a?.verificacao?.pendencias ?? [];
    const porTipo = ps.reduce((t, x) => ({ ...t, [x.tipo]: (t[x.tipo] ?? 0) + 1 }), {});
    const ch = a?.uso?.chamadas ?? {};
    console.log(`  análise ${d.analiseAtual}: ${a?.verificacao?.status ?? 'sem verificação'} – pendências ${ps.length}${ps.length ? ` (${Object.entries(porTipo).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''} – porta ${a?.enquadramento?.portaProvavel} – escopo ${a?.enquadramento?.escopo}`);
    console.log(`  síntese (esforço ${a?.uso?.esforco ?? '-'}): ${Object.entries(ch).map(([k, v]) => `${k} ${v.tokensEntrada}/${v.tokensSaida} ${Math.round((v.duracaoMs ?? 0) / 1000)}s US$ ${(v.usdEstimado ?? 0).toFixed(4)}`).join(' – ')} – revisor US$ ${(a?.uso?.revisor?.usdEstimado ?? 0).toFixed(4)} – total da versão US$ ${(a?.uso?.usdEstimado ?? 0).toFixed(4)}`);
    for (const x of ps.slice(0, 12)) console.log(`      [${x.tipo}] ${x.secao}: ${x.regra ? `(${x.regra}) ` : ''}${String(x.trecho ?? x.texto).slice(0, 150)}`);
  }
  const usd = (d?.custo?.usdEstimado ?? 0) - (c.usdAntes ?? 0);
  console.log(`  custo ${c.reexecucao ? 'desta reexecução' : 'da ficha'}: US$ ${usd.toFixed(4)} – buscas da ficha ${d?.custo?.buscas ?? 0}`);
  return usd;
}

let total = 0;
if (umaPorVez) {
  for (const c of fichas) {
    if (c.reexecucao) await reabre(c);
    total += await relata(c);
  }
} else {
  for (const c of fichas) if (c.reexecucao) await reabre(c);
  for (const c of fichas) total += await relata(c);
}
console.log(`\ncusto total: US$ ${total.toFixed(4)}`);
