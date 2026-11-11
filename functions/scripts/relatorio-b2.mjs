// Report of phase B2 (spec/alteracoes-specs-01-02-portoes-correcao.md, section 7, items 5 and 6) in Markdown.
// Read-only: reads the five B2 fichas, classifies each version by round and design (scripts/b2-rodadas.mjs)
// and writes, per ficha, design and round, the measures of item 5; per design, the stability and totals; and
// the criterion of item 6 applied mechanically. It carries no analysis text, only labels, counts and costs,
// but it is for the administrator only and is not committed.
// Usage: node scripts/relatorio-b2.mjs <project id> <output.md>
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FICHAS_B2, RODADA_CORRECAO, ROTULO_RODADA, desenhoDe, rodadaDe } from './b2-rodadas.mjs';

// --- Pure part (tested without Firestore) ----------------------------------------------------------------

const conta = (xs, chave) => xs.reduce((t, x) => {
  const k = chave(x);
  t[k] = (t[k] ?? 0) + 1;
  return t;
}, {});
const lista = (o) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ') || '–';
// Checklist rule id without the text the reviewer sometimes appends ("limite-1: Operação contínua…").
const regraId = (r) => String(r ?? '?').split(':')[0].trim();
const usd = (n) => (typeof n === 'number' ? `US$ ${n.toFixed(4)}` : '–');
const seg = (ms) => (typeof ms === 'number' && ms > 0 ? `${Math.round(ms / 1000)} s` : '–');
const soma = (xs) => xs.reduce((t, x) => t + (x ?? 0), 0);
const media = (xs) => (xs.length ? soma(xs) / xs.length : null);

// Calls of a version: [name, usage] for each one, repairs one per stage.
function chamadas(uso) {
  return Object.entries(uso ?? {})
    .filter(([k]) => k !== 'total')
    .flatMap(([k, x]) => (Array.isArray(x) ? x.map((y) => [`reparar·${y.origem ?? '?'}`, y]) : [[k, x]]));
}

// Repair calls of the round, from the "reparo" events of the base version and of its correction: total,
// rejected by limiarReparo (motivo "mudança fora dos trechos de X%") and rejected for another reason.
export function chamadasDeReparo(eventos) {
  const xs = eventos ?? [];
  const limiar = xs.filter((e) => !e.aceito && /^mudança fora dos trechos/.test(String(e.motivo ?? ''))).length;
  return { total: xs.length, rejeitadasLimiar: limiar, rejeitadasOutras: xs.filter((e) => !e.aceito).length - limiar };
}

// One round of one ficha in one design: the base version (synthesis) and its correction, if any.
export function medidasDaRodada(base, correcao, lead, eventosReparo = []) {
  const enq = base.enquadramento ?? {};
  const det = enq.detalhe ?? {};
  const ver = base.verificacao ?? {};
  const pend = ver.pendencias ?? [];
  const reparos = ver.reparos ?? [];
  const regrasNoReparo = new Set(reparos.map((r) => r.regra));
  const mecDepois = pend.filter((p) => p.tipo === 'mecanica');
  // Before the repair: what was sent to it plus the mechanical failures of rules that do not go to it.
  const antes = conta([...reparos, ...mecDepois.filter((p) => !regrasNoReparo.has(p.regra))], (x) => x.regra ?? '?');
  const depois = conta(mecDepois, (p) => p.regra ?? '?');
  const revisor = conta(pend.filter((p) => p.tipo !== 'mecanica'), (p) => p.tipo);
  const violadas = (ver.checklist ?? []).filter((c) => c.resultado === 'violado');
  // Treatments from the correction record or, without it, from the issues the correction version carries.
  const tratamentos = correcao?.correcao?.tratamentos ?? (correcao?.verificacao?.pendencias ?? []).filter((p) => p.tratamento);
  const riscos = (det.riscosDoLead ?? []).map((r) => `${r.risco}/${r.origem ?? '?'}`);
  const removidos = det.escopo?.itensRemovidos ?? [];
  const avisos = ver.avisos ?? [];
  const cs = [...chamadas(base.uso), ...chamadas(correcao?.uso).filter(([k]) => k === 'corrigir')];
  const sintese = cs.filter(([k]) => ['enquadrar', 'preparar_conversa', 'montar_analise'].includes(k));
  return {
    pontos: lead?.pontos ?? null,
    grau: lead?.grau ?? null,
    quadrante: lead?.quadrante ?? null,
    destino: lead?.destino ?? null,
    tecnologia: enq.estruturaTecnologia?.categoria ?? null,
    escopo: enq.escopo ?? null,
    escopoDeclarado: det.escopo?.resultadoDeclarado ?? null,
    porta: enq.portaProvavel ?? null,
    direcao: det.leituraDoPotencial?.direcao ?? null,
    confianca: det.leituraDoPotencial?.confianca ?? null,
    riscos: conta(riscos, (x) => x),
    removidos: removidos.length,
    avisosRemocao: avisos.filter((a) => a.startsWith('item_removido_por_origem')).length,
    antes,
    depois,
    reparosAceitos: reparos.filter((r) => r.aceito).length,
    reparosRejeitados: reparos.filter((r) => !r.aceito).length,
    chamadasReparo: chamadasDeReparo(eventosReparo),
    revisor,
    escopoPend: pend.filter((p) => p.tipo === 'escopo').length,
    checklistViolado: conta(violadas, (c) => regraId(c.regra)),
    checklist: Object.fromEntries((ver.checklist ?? []).map((c) => [regraId(c.regra), c.resultado])),
    checklistRotulosVariaveis: (ver.checklist ?? []).filter((c) => String(c.regra ?? '').includes(':')).length,
    corrigidas: tratamentos.filter((t) => t.tratamento === 'corrigida').length,
    mantidas: tratamentos.filter((t) => t.tratamento === 'mantida').length,
    correcaoFalhou: avisos.filter((a) => a.startsWith('correcao_falhou')).length,
    temCorrecao: !!correcao,
    estadoFinal: (correcao ?? base).verificacao?.status ?? null,
    chamadas: cs.map(([k, c]) => ({ k, modelo: c.modelo, esforco: c.esforco, cacheLidos: c.cacheLidos ?? 0, cacheEscritos: c.cacheEscritos ?? 0, duracaoMs: c.duracaoMs ?? null, usd: c.usdEstimado ?? null })),
    usd: soma(cs.map(([, c]) => c.usdEstimado)),
    duracaoSintese: soma(sintese.map(([, c]) => c.duracaoMs)),
    duracaoTotal: soma(cs.map(([, c]) => c.duracaoMs)),
    versoes: [base.id, correcao?.id].filter(Boolean).join(' → '),
  };
}

// Rounds of the B2 fichas: [{ficha, empresa, rodada, desenho, m}] in time order.
export function rodadas(fichas) {
  const out = [];
  for (const f of fichas) {
    for (const v of f.versoes) {
      if (v.origem === 'correcao') continue;
      const rodada = rodadaDe(f.id, v, f.versoes);
      if (rodada === 'anterior' || rodada === 'diagnostico') continue;
      const correcao = f.versoes.find((x) => x.origem === 'correcao' && x.baseadaEm === v.id) ?? null;
      out.push({ ficha: f.id, empresa: f.empresa, rodada, desenho: desenhoDe(v.uso?.montar_analise?.modelo ?? v.autor?.id), versao: v.id, m: medidasDaRodada(v, correcao, f.graduadas?.[v.id], [...(f.reparos?.[v.id] ?? []), ...(correcao ? f.reparos?.[correcao.id] ?? [] : [])]) });
    }
  }
  return out;
}

const amplitude = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : null);
const distintos = (xs) => new Set(xs.filter((x) => x !== null && x !== undefined)).size;

// Checklist rules whose result changed between two rounds of the same ficha and design.
function checklistMudou(rs) {
  const regras = new Set(rs.flatMap((r) => Object.keys(r.m.checklist)));
  return [...regras].filter((k) => distintos(rs.map((r) => r.m.checklist[k] ?? 'ausente')) > 1);
}

export function relatorio(fichas, geradoEm = new Date().toISOString()) {
  const rs = rodadas(fichas);
  const empresas = Object.fromEntries(fichas.map((f) => [f.id, f.empresa]));
  const L = [];
  L.push('# Fase B2 – relatório de medidas', '');
  L.push(`Gerado em ${geradoEm} a partir de gmdb-qualidade. Uso interno.`, '');
  L.push('Rodadas: **automática** (primeira versão da quinta ficha, na configuração vigente); **rodada 1 sem correção** (8/11, todas as chamadas de correção recusadas pela API por gramática grande demais); **rodada 1 com correção** (9/11, depois do conserto, commit b39ca61); **rodada 1 com correção, spec 02 v0.13** (9/11, títulos e propósitos fixos das seções e checklist de estrutura no revisor, commit 4aced6e); **rodada 1 com correção, spec 02 v0.15** (10/11, rótulos de subseção e regra bloco_sem_rotulo, commit b47ebd6); **reteste do desenho C, spec 02 v0.16** (10/11, só GAT Logística e Elite 90 Pro, três rodadas por desenho, reparo em Sonnet 5.5, commit f406a14); **rodada 1 com correção, spec 02 v0.19** (11/11, rótulos fixos por seção, porta.combinacao e regraNome, commit 0e01ece). As versões de diagnóstico da Capal (v5 a v8) ficam fora. As rodadas 2 e 3 não foram executadas (decisão de Gon, 9/11/2026).', '');
  L.push('Desenho A: Sonnet 5.5 em enquadrar, preparar_conversa e montar_analise. Desenho C: Sonnet 5.5 em enquadrar; Haiku 5.5 em preparar_conversa e montar_analise. A correção usa o modelo de montar_analise. Nos dois desenhos, pontos, grau, quadrante, destino, tecnologia, escopo, porta, riscos e itens removidos saem de enquadrar, que é o mesmo modelo.', '');
  L.push('"Antes do reparo" = itens enviados ao reparo mais as falhas mecânicas de regras que não vão ao reparo; "depois" = pendências mecânicas gravadas na versão.', '');

  L.push('## 1. Por ficha, desenho e rodada', '');
  for (const id of FICHAS_B2) {
    const doF = rs.filter((r) => r.ficha === id);
    if (!doF.length) continue;
    L.push(`### ${empresas[id] ?? id}`, '');
    L.push('| Rodada | Desenho | Versões | Pontos | Grau | Quadrante | Destino | Tecnologia | Escopo (declarado) | Porta | Direção (confiança) | Riscos tipo/origem | Removidos por origem | Estado final |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of doF) {
      const m = r.m;
      L.push(`| ${ROTULO_RODADA[r.rodada]} | ${r.desenho} | ${m.versoes} | ${m.pontos ?? '–'} | ${m.grau ?? '–'} | ${m.quadrante ?? '–'} | ${m.destino ?? '–'} | ${m.tecnologia ?? '–'} | ${m.escopo ?? '–'} (${m.escopoDeclarado ?? '–'}) | ${m.porta ?? '–'} | ${m.direcao ?? '–'} (${m.confianca ?? '–'}) | ${lista(m.riscos)} | ${m.removidos} | ${m.estadoFinal ?? '–'} |`);
    }
    L.push('');
    L.push('| Rodada | Desenho | Mecânicas antes do reparo | Depois | Reparos aceitos / rejeitados | Revisor (por tipo) | Checklist violado | Corrigidas / mantidas | Correção recusada | Custo | Duração da síntese / total |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of doF) {
      const m = r.m;
      L.push(`| ${ROTULO_RODADA[r.rodada]} | ${r.desenho} | ${lista(m.antes)} | ${lista(m.depois)} | ${m.reparosAceitos} / ${m.reparosRejeitados} | ${lista(m.revisor)} | ${lista(m.checklistViolado)} | ${m.temCorrecao ? `${m.corrigidas} / ${m.mantidas}` : '–'} | ${m.correcaoFalhou} | ${usd(m.usd)} | ${seg(m.duracaoSintese)} / ${seg(m.duracaoTotal)} |`);
    }
    L.push('');
    L.push('Chamadas (modelo, esforço, cache lido / gravado, duração, custo):', '');
    for (const r of doF) {
      L.push(`- ${ROTULO_RODADA[r.rodada]}, desenho ${r.desenho}: ${r.m.chamadas.map((c) => `${c.k} ${c.modelo ?? '?'} ${c.esforco ?? '?'} ${c.cacheLidos}/${c.cacheEscritos} ${seg(c.duracaoMs)} ${usd(c.usd)}`).join(' · ')}`);
    }
    L.push('');
  }

  const rodadasB2 = [...new Set(rs.filter((r) => r.rodada !== 'automatica').map((r) => r.rodada))];
  const amostras = rodadasB2.map((r) => ROTULO_RODADA[r]).join('; ');
  // Samples per ficha and design vary: the retest added versions only to the fichas it ran on.
  const nPor = FICHAS_B2.flatMap((id) => ['A', 'C'].map((d) => rs.filter((r) => r.ficha === id && r.desenho === d && r.rodada !== 'automatica').length)).filter((n) => n > 0);
  const nMin = Math.min(...nPor), nMax = Math.max(...nPor);
  const nAmostras = nMin === nMax ? `${nMin}` : `de ${nMin} a ${nMax}`;
  L.push('## 2. Por desenho', '');
  L.push(`Amostras: ${amostras} (${nAmostras} por ficha e desenho, conforme as rodadas em que a ficha entrou); a automática fica fora da comparação por desenho. As medidas de correção são as da ${ROTULO_RODADA[RODADA_CORRECAO]}.`, '');
  const porDesenho = {};
  for (const d of ['A', 'C']) {
    const rd = rs.filter((r) => r.desenho === d && r.rodada !== 'automatica');
    const fichasD = FICHAS_B2.filter((id) => rd.some((r) => r.ficha === id));
    const linhas = fichasD.map((id) => {
      const x = rd.filter((r) => r.ficha === id);
      return {
        id,
        pontos: x.map((r) => r.m.pontos).filter((p) => p !== null),
        trocasGrau: distintos(x.map((r) => r.m.grau)) > 1,
        tec: distintos(x.map((r) => r.m.tecnologia)),
        escopo: distintos(x.map((r) => r.m.escopo)),
        porta: distintos(x.map((r) => r.m.porta)),
        escopoPend: x.map((r) => r.m.escopoPend),
        removidos: soma(x.map((r) => r.m.removidos)),
        checklistMudou: checklistMudou(x),
      };
    });
    const comCorr = rd.filter((r) => r.rodada === RODADA_CORRECAO);
    porDesenho[d] = { rd, linhas, comCorr };
    L.push(`### Desenho ${d}`, '');
    L.push('| Ficha | Pontos nas rodadas | Amplitude | Troca de grau | Tecnologia (valores distintos) | Escopo (distintos) | Porta (distintos) | Pendências de escopo por rodada | Removidos por origem | Checklist que mudou entre rodadas |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const l of linhas) {
      L.push(`| ${empresas[l.id] ?? l.id} | ${l.pontos.join(', ') || '–'} | ${amplitude(l.pontos) ?? '–'} | ${l.trocasGrau ? 'sim' : 'não'} | ${l.tec} | ${l.escopo} | ${l.porta} | ${l.escopoPend.join(', ')} | ${l.removidos} | ${l.checklistMudou.join(', ') || 'nenhuma'} |`);
    }
    L.push('');
    const tot = (f) => soma(rd.map((r) => f(r.m)));
    const totObj = (f) => rd.reduce((t, r) => { for (const [k, n] of Object.entries(f(r.m))) t[k] = (t[k] ?? 0) + n; return t; }, {});
    L.push(`- Mecânicas antes do reparo: ${lista(totObj((m) => m.antes))}`);
    L.push(`- Mecânicas depois do reparo: ${lista(totObj((m) => m.depois))}`);
    L.push(`- Reparos aceitos / rejeitados: ${tot((m) => m.reparosAceitos)} / ${tot((m) => m.reparosRejeitados)}`);
    L.push(`- Pendências do revisor por tipo: ${lista(totObj((m) => m.revisor))}`);
    L.push(`- Checklist violado por regra: ${lista(totObj((m) => m.checklistViolado))}`);
    const cr = comCorr.map((r) => r.m.chamadasReparo ?? { total: 0, rejeitadasLimiar: 0, rejeitadasOutras: 0 });
    L.push(`- Chamadas de reparo na ${ROTULO_RODADA[RODADA_CORRECAO]}: ${soma(cr.map((c) => c.total))}; rejeitadas pelo limiarReparo: ${soma(cr.map((c) => c.rejeitadasLimiar))}; rejeitadas por outro motivo: ${soma(cr.map((c) => c.rejeitadasOutras))}`);
    L.push(`- Rodada com correção: corrigidas ${soma(comCorr.map((r) => r.m.corrigidas))}, mantidas ${soma(comCorr.map((r) => r.m.mantidas))}, correções recusadas ${soma(comCorr.map((r) => r.m.correcaoFalhou))}; estado final pronta em ${comCorr.filter((r) => r.m.estadoFinal === 'pronta').length} de ${comCorr.length}`);
    const custoCorr = media(comCorr.map((r) => r.m.usd));
    const custoSem = media(rd.filter((r) => r.rodada === 'R1').map((r) => r.m.usd));
    L.push(`- Custo médio por ficha: ${usd(custoCorr)} com correção; ${usd(custoSem)} na rodada sem correção`);
    L.push(`- Duração média da síntese: ${seg(media(rd.map((r) => r.m.duracaoSintese)))}; da rodada com correção, total: ${seg(media(comCorr.map((r) => r.m.duracaoTotal)))}`);
    L.push('');
  }

  L.push('## 3. Critério da seção 7, item 6, aplicado de forma mecânica', '');
  L.push('Texto: "o desenho C substitui o A se a variância de pontos e a taxa de pendências de escopo ficarem dentro da faixa do A nas cinco fichas, e se nenhuma versão do C trouxer item de escopo ou risco removido por origem."', '');
  L.push(`Leitura mecânica adotada: (a) por ficha, amplitude dos pontos do C ≤ amplitude do A; (b) por ficha, cada contagem de pendências de escopo do C entre o mínimo e o máximo do A; (c) soma de itens removidos por origem nas versões do C igual a zero. Amostras: ${nAmostras} por ficha e desenho.`, '');
  const A = porDesenho.A?.linhas ?? [], C = porDesenho.C?.linhas ?? [];
  const pares = FICHAS_B2.map((id) => [A.find((l) => l.id === id), C.find((l) => l.id === id)]).filter(([a, c]) => a && c);
  const condA = pares.map(([a, c]) => ({ id: a.id, ok: (amplitude(c.pontos) ?? 0) <= (amplitude(a.pontos) ?? 0), a: amplitude(a.pontos), c: amplitude(c.pontos) }));
  const condB = pares.map(([a, c]) => {
    const min = Math.min(...a.escopoPend), max = Math.max(...a.escopoPend);
    return { id: a.id, ok: c.escopoPend.every((n) => n >= min && n <= max), faixa: `${min}–${max}`, c: c.escopoPend.join(', ') };
  });
  const removC = soma(C.map((l) => l.removidos));
  const okA = condA.every((x) => x.ok), okB = condB.every((x) => x.ok), okC = removC === 0;
  L.push('| Ficha | (a) amplitude A / C | (a) | (b) faixa do A / valores do C | (b) |');
  L.push('|---|---|---|---|---|');
  for (let i = 0; i < pares.length; i++) {
    L.push(`| ${empresas[condA[i].id] ?? condA[i].id} | ${condA[i].a} / ${condA[i].c} | ${condA[i].ok ? 'atende' : 'não atende'} | ${condB[i].faixa} / ${condB[i].c} | ${condB[i].ok ? 'atende' : 'não atende'} |`);
  }
  L.push('');
  L.push(`- (a) variância de pontos: ${okA ? 'atendida' : 'não atendida'} (atende em ${condA.filter((x) => x.ok).length} de ${pares.length} fichas)`);
  L.push(`- (b) taxa de pendências de escopo: ${okB ? 'atendida' : 'não atendida'} (atende em ${condB.filter((x) => x.ok).length} de ${pares.length} fichas)`);
  L.push(`- (c) itens removidos por origem nas versões do C: ${removC} – ${okC ? 'atendida' : 'não atendida'}`);
  L.push(`- **Resultado: critério ${okA && okB && okC ? 'atendido' : 'não atendido'}.**`, '');
  L.push(`Observações: (a) e (c) dependem de enquadrar, que é o mesmo modelo nos dois desenhos; só (b) depende do desenho. ${nAmostras} amostras por desenho e ficha. A decisão sobre o desenho é de Gon.`, '');
  return { md: L.join('\n'), rodadas: rs.length };
}

// --- Firestore part ----------------------------------------------------------------------------------------

async function principal() {
  const [projeto, saida] = process.argv.slice(2);
  if (!projeto || !saida) {
    console.error('Usage: node scripts/relatorio-b2.mjs <project id> <output.md>');
    process.exit(1);
  }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: projeto });
  const db = getFirestore();
  // REST transport, as in comparar-analises.mjs: over gRPC the reads stalled in Cloud Shell with no error.
  db.settings({ preferRest: true });
  const fichas = [];
  for (const id of FICHAS_B2) {
    const ref = db.collection('fichas').doc(id);
    const f = await ref.get();
    if (!f.exists) continue;
    const versoes = (await ref.collection('analise').get()).docs.map((d) => {
      const x = d.data();
      return { id: d.id, n: Number(d.id.slice(1)), ...x, origem: x.autor?.origem ?? null, criadaEm: x.criadaEm?.toDate?.().toISOString() ?? null };
    }).sort((a, b) => a.n - b.n);
    const graduadas = Object.fromEntries((await ref.collection('eventos').where('tipo', '==', 'graduada').get()).docs.map((e) => [e.get('detalhe.versao'), e.get('detalhe')]));
    const reparos = {};
    for (const e of (await ref.collection('eventos').where('tipo', '==', 'reparo').get()).docs) {
      const d = e.get('detalhe') ?? {};
      (reparos[d.versao] ??= []).push({ etapa: d.etapa, aceito: d.aceito, motivo: d.motivo ?? null });
    }
    fichas.push({ id, empresa: f.get('original.empresa'), versoes, graduadas, reparos });
  }
  const r = relatorio(fichas);
  writeFileSync(saida, r.md);
  console.log(`${saida}: ${r.rodadas} rodadas, ${Math.round(r.md.length / 1024)} KB`);
  // The REST client keeps connections open; end the process once the file is written.
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await principal();
