// Short report of the design C retest (spec 02 v0.16; spec/alteracoes-specs-01-02-portoes-correcao.md v1.8,
// section 7, item 8): GAT Logística and Elite 90 Pro, three complete rounds per design (synthesis, repair,
// reviewer, correction), compared with round R1f of the same fichas. Per round: source marks pointing to no
// source in the final text, repairs asked and rejected by rule, issues corrected and kept, mechanical issues
// left by rule, final status, cost with and without cache, duration. Read-only; labels, counts and costs only.
// Usage: node scripts/relatorio-reteste.mjs <project id> <output.md>
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROTULO_RODADA, desenhoDe, rodadaDe } from './b2-rodadas.mjs';

export const FICHAS_RETESTE = ['DObT8Tr5ERKfCRZ0L6vj', 'PERUGOBEiTWP7kBxeRTz'];
const ETAPAS = ['empresa_registro', 'empresa_digital', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado'];
const RODADAS = ['R1f', 'RT'];

// --- Pure part (tested without Firestore) ----------------------------------------------------------------

const conta = (xs, chave) => xs.reduce((t, x) => {
  const k = chave(x);
  t[k] = (t[k] ?? 0) + 1;
  return t;
}, {});
const lista = (o) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ') || '–';
const soma = (xs) => xs.reduce((t, x) => t + (x ?? 0), 0);
const usd = (n) => `US$ ${n.toFixed(4)}`;
const seg = (ms) => `${Math.round(ms / 1000)} s`;

// Source marks of a version that point to no source: [F:etapa:idx] in any text and {etapa, fonteIdx} pairs of
// the enquadramento, against the number of sources of each collection stage (0 or missing: none can be cited).
export function marcasInventadas(versao, fontesPorEtapa) {
  const valida = (etapa, idx) => Number.isInteger(idx) && idx >= 0 && idx < (fontesPorEtapa[etapa] ?? 0);
  const textos = {
    secoes: Object.fromEntries(['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((s) => [s, versao.secoes?.[s]?.corpo ?? ''])),
    resumoExecutivo: versao.resumoExecutivo ?? '', rascunhoResposta: versao.rascunhoResposta ?? {}, conversa: versao.conversa ?? {},
    enquadramento: versao.enquadramento?.detalhe ?? {},
  };
  const invalidas = [];
  for (const m of JSON.stringify(textos).matchAll(/\[F:([a-z_]+):(\d+)\]/g)) if (!valida(m[1], Number(m[2]))) invalidas.push(`${m[1]}:${m[2]}`);
  const pares = (x) => {
    if (Array.isArray(x)) x.forEach(pares);
    else if (x && typeof x === 'object') {
      if (typeof x.etapa === 'string' && 'fonteIdx' in x && !valida(x.etapa, x.fonteIdx)) invalidas.push(`${x.etapa}:${x.fonteIdx}`);
      Object.values(x).forEach(pares);
    }
  };
  pares(textos.enquadramento);
  return invalidas;
}

// One complete round: the synthesis version, its correction (if any) and the repair events of both.
export function medidasDaRodada(base, correcao, eventos, fontesPorEtapa) {
  const final = correcao ?? base;
  const reparos = [...(base.verificacao?.reparos ?? []), ...(correcao?.verificacao?.reparos ?? [])];
  const tratamentos = correcao?.correcao?.tratamentos ?? [];
  const pelaCorrecao = tratamentos.filter((t) => t.razao !== 'bloco estruturado não editável pela correção');
  const ev = eventos ?? [];
  const totais = [base.uso?.total ?? {}, correcao?.uso?.total ?? {}];
  return {
    versoes: [base.id, correcao?.id].filter(Boolean).join(' → '),
    inventadas: marcasInventadas(final, fontesPorEtapa),
    pedidos: conta(reparos, (r) => r.regra ?? '?'),
    rejeitados: conta(reparos.filter((r) => !r.aceito), (r) => r.regra ?? '?'),
    chamadasReparo: ev.length,
    chamadasRejeitadasLimiar: ev.filter((e) => !e.aceito && /^mudança fora dos trechos/.test(String(e.motivo ?? ''))).length,
    corrigidas: pelaCorrecao.filter((t) => t.tratamento === 'corrigida').length,
    mantidas: pelaCorrecao.filter((t) => t.tratamento === 'mantida').length,
    mantidasPeloCodigo: tratamentos.length - pelaCorrecao.length,
    correcaoFalhou: (base.verificacao?.avisos ?? []).filter((a) => String(a).startsWith('correcao_falhou')).length,
    mecanicas: conta((final.verificacao?.pendencias ?? []).filter((p) => p.tipo === 'mecanica'), (p) => p.regra ?? '?'),
    status: final.verificacao?.status ?? '–',
    usd: soma(totais.map((t) => t.usdEstimado)),
    usdSemCache: soma(totais.map((t) => t.usdSemCache)),
    duracaoMs: soma(totais.map((t) => t.duracaoMs)),
  };
}

// Rounds R1f and RT of the retest fichas, numbered by time within each ficha, round and design.
export function rodadasDoReteste(fichas) {
  const r = [];
  for (const f of fichas) {
    const sinteses = f.versoes.filter((v) => v.origem !== 'correcao' && v.autor?.tipo === 'ia');
    const n = {};
    for (const v of sinteses) {
      const rodada = rodadaDe(f.id, v, f.versoes);
      if (!RODADAS.includes(rodada)) continue;
      const desenho = desenhoDe(v.uso?.montar_analise?.modelo);
      const chave = `${rodada}${desenho}`;
      n[chave] = (n[chave] ?? 0) + 1;
      const correcao = f.versoes.find((x) => x.origem === 'correcao' && x.baseadaEm === v.id) ?? null;
      const eventos = [...(f.reparos[v.id] ?? []), ...(correcao ? f.reparos[correcao.id] ?? [] : [])];
      r.push({ empresa: f.empresa, rodada, desenho, n: n[chave], m: medidasDaRodada(v, correcao, eventos, f.fontesPorEtapa) });
    }
  }
  return r;
}

export function relatorioReteste(fichas, geradoEm = new Date()) {
  const rs = rodadasDoReteste(fichas);
  const L = [
    '# Reteste do desenho C – spec 02 v0.16', '',
    `Gerado em ${geradoEm.toISOString().slice(0, 16).replace('T', ' ')} UTC. Fichas GAT Logística e Elite 90 Pro; rodadas completas (síntese, reparo, revisor, correção). ${ROTULO_RODADA.RT}: três por desenho, reparo em Sonnet 5.5 nos dois desenhos. ${ROTULO_RODADA.R1f}: uma por desenho, para comparação.`, '',
    '## 1. Por rodada', '',
    '| Ficha | Rodada | Desenho | Nº | Versões | Marcas inventadas no texto final | Reparos pedidos | Reparos rejeitados | Chamadas de reparo / rejeitadas pelo limiar | Corrigidas / mantidas (mantidas pelo código) | Mecânicas restantes | Status final | Custo com cache | Custo sem cache | Duração |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const x of rs) {
    const m = x.m;
    L.push(`| ${x.empresa} | ${x.rodada} | ${x.desenho} | ${x.n} | ${m.versoes} | ${m.inventadas.length}${m.inventadas.length ? ` (${m.inventadas.join(', ')})` : ''} | ${lista(m.pedidos)} | ${lista(m.rejeitados)} | ${m.chamadasReparo} / ${m.chamadasRejeitadasLimiar} | ${m.corrigidas} / ${m.mantidas} (${m.mantidasPeloCodigo})${m.correcaoFalhou ? ' – correção falhou' : ''} | ${lista(m.mecanicas)} | ${m.status} | ${usd(m.usd)} | ${usd(m.usdSemCache)} | ${seg(m.duracaoMs)} |`);
  }
  L.push('', '## 2. Por rodada e desenho', '',
    '| Rodada | Desenho | Rodadas | Marcas inventadas no texto final | Reparos pedidos / rejeitados | Chamadas rejeitadas pelo limiar | Corrigidas / mantidas (pelo código) | Mecânicas restantes | Prontas | Custo médio com / sem cache | Duração média |',
    '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const rodada of RODADAS) {
    for (const d of ['A', 'C']) {
      const g = rs.filter((x) => x.rodada === rodada && x.desenho === d).map((x) => x.m);
      if (!g.length) continue;
      const k = g.length;
      const mec = {};
      for (const m of g) for (const [r, n] of Object.entries(m.mecanicas)) mec[r] = (mec[r] ?? 0) + n;
      L.push(`| ${rodada} | ${d} | ${k} | ${soma(g.map((m) => m.inventadas.length))} | ${soma(g.map((m) => soma(Object.values(m.pedidos))))} / ${soma(g.map((m) => soma(Object.values(m.rejeitados))))} | ${soma(g.map((m) => m.chamadasRejeitadasLimiar))} | ${soma(g.map((m) => m.corrigidas))} / ${soma(g.map((m) => m.mantidas))} (${soma(g.map((m) => m.mantidasPeloCodigo))}) | ${lista(mec)} | ${g.filter((m) => m.status === 'pronta').length} de ${k} | ${usd(soma(g.map((m) => m.usd)) / k)} / ${usd(soma(g.map((m) => m.usdSemCache)) / k)} | ${seg(soma(g.map((m) => m.duracaoMs)) / k)} |`);
    }
  }
  L.push('', 'Marcas inventadas: marca de fonte [F:etapa:idx] ou par {etapa, fonteIdx} do enquadramento que aponta para índice inexistente, ou para etapa sem fontes, na versão final da rodada (a correção, quando houver). Custo sem cache: o que as mesmas chamadas custariam sem leitura nem gravação de cache (campo usdSemCache).', '');
  return { md: L.join('\n'), rodadas: rs.length };
}

// --- Firestore part ------------------------------------------------------------------------------------------

async function principal() {
  const [projeto, saida] = process.argv.slice(2);
  if (!projeto || !saida) {
    console.error('Usage: node scripts/relatorio-reteste.mjs <project id> <output.md>');
    process.exit(1);
  }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: projeto });
  const db = getFirestore();
  // REST transport, as in the other B2 scripts: over gRPC the reads stalled in Cloud Shell with no error.
  db.settings({ preferRest: true });
  const fichas = [];
  for (const id of FICHAS_RETESTE) {
    const ref = db.collection('fichas').doc(id);
    const f = await ref.get();
    if (!f.exists) continue;
    const versoes = (await ref.collection('analise').get()).docs.map((d) => {
      const x = d.data();
      return { id: d.id, n: Number(d.id.slice(1)), ...x, origem: x.autor?.origem ?? null, criadaEm: x.criadaEm?.toDate?.().toISOString() ?? null };
    }).sort((a, b) => a.n - b.n);
    const reparos = {};
    for (const e of (await ref.collection('eventos').where('tipo', '==', 'reparo').get()).docs) {
      const d = e.get('detalhe') ?? {};
      (reparos[d.versao] ??= []).push({ etapa: d.etapa, aceito: d.aceito, motivo: d.motivo ?? null });
    }
    const fontesPorEtapa = {};
    // Only a finished stage can be cited, as in coletaDe (src/sintese.ts).
    for (const e of ETAPAS) {
      const d = (await ref.collection('coleta').doc(e).get()).data();
      fontesPorEtapa[e] = d?.status === 'concluida' && Array.isArray(d.fontes) ? d.fontes.length : 0;
    }
    fichas.push({ id, empresa: f.get('original.empresa'), versoes, reparos, fontesPorEtapa });
  }
  const r = relatorioReteste(fichas);
  writeFileSync(saida, r.md);
  console.log(`${saida}: ${r.rodadas} rodadas, ${Math.round(r.md.length / 1024)} KB`);
  // The REST client keeps connections open; end the process once the file is written.
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await principal();
