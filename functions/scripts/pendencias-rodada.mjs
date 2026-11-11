// Issues of one round of phase B2, with their text, to read why analyses ended "com pendências": for each
// correction version of the round, the issues the correction kept (with its reason), the structure issues
// (secao-s1 to secao-s7, corrected or kept) and the mechanical issues left after the checks.
// Read-only. The output carries analysis excerpts of the test fichas (invented names); it is for the
// administrator only and is not committed.
// Usage: node scripts/pendencias-rodada.mjs <project id> <round, e.g. R1g> <output.md>
import { writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FICHAS_B2, ROTULO_RODADA, desenhoDe, rodadaDe } from './b2-rodadas.mjs';

const [projeto, rodada, saida] = process.argv.slice(2);
if (!projeto || !rodada || !saida || !ROTULO_RODADA[rodada]) {
  console.error('Usage: node scripts/pendencias-rodada.mjs <project id> <round> <output.md>');
  process.exit(1);
}
initializeApp({ projectId: projeto });
const db = getFirestore();
// REST transport, as in the other B2 scripts: over gRPC the reads stalled in Cloud Shell.
db.settings({ preferRest: true });

const curto = (t, n = 400) => String(t ?? '–').replace(/\s+/g, ' ').slice(0, n);
const L = [`# Pendências da ${ROTULO_RODADA[rodada]}`, '', `Gerado em ${new Date().toISOString()} a partir de ${projeto}. Uso interno.`, ''];
const totais = { mantidas: {}, estrutura: { corrigida: 0, mantida: 0 }, mecanicas: {} };
const conta = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

for (const id of FICHAS_B2) {
  const ref = db.collection('fichas').doc(id);
  const f = await ref.get();
  if (!f.exists) continue;
  const versoes = (await ref.collection('analise').get()).docs.map((d) => {
    const x = d.data();
    return { id: d.id, n: Number(d.id.slice(1)), ...x, origem: x.autor?.origem ?? null, criadaEm: x.criadaEm?.toDate?.().toISOString() ?? null };
  }).sort((a, b) => a.n - b.n);
  const daRodada = versoes.filter((v) => v.origem === 'correcao' && rodadaDe(id, v, versoes) === rodada);
  for (const v of daRodada) {
    const base = versoes.find((x) => x.id === v.baseadaEm);
    const desenho = desenhoDe(base?.uso?.montar_analise?.modelo);
    L.push(`## ${f.get('original.empresa')} – desenho ${desenho} – ${v.baseadaEm} → ${v.id}`, '');
    const pend = v.correcao?.pendencias ?? [];
    const trat = v.correcao?.tratamentos ?? [];
    const comT = pend.map((p, i) => ({ ...p, t: trat.find((x) => x.indice === i) ?? null }));
    const mantidas = comT.filter((p) => p.t?.tratamento === 'mantida');
    L.push(`### Mantidas pela correção (${mantidas.length})`, '');
    for (const p of mantidas) {
      conta(totais.mantidas, p.secao === 'enquadramento' ? 'enquadramento (não vai à correção)' : p.tipo);
      L.push(`- **${p.tipo}${p.regra ? ` · ${p.regraNome ?? p.regra}` : ''}** – ${p.secao}`, `  - Trecho: ${curto(p.trecho)}`, `  - Sugestão do revisor: ${curto(p.correcaoSugerida)}`, `  - Razão da correção: ${curto(p.t?.razao)}`);
    }
    const estrutura = comT.filter((p) => p.tipo === 'estrutura');
    L.push('', `### Estrutura – secao-s1 a secao-s7 (${estrutura.length})`, '');
    for (const p of estrutura) {
      conta(totais.estrutura, p.t?.tratamento ?? 'sem tratamento');
      L.push(`- **${p.regraNome ?? p.regra}** – ${p.t?.tratamento ?? 'sem tratamento'}`, `  - Trecho: ${curto(p.trecho)}`, `  - Sugestão do revisor: ${curto(p.correcaoSugerida)}`, ...(p.t?.tratamento === 'mantida' ? [`  - Razão da correção: ${curto(p.t?.razao)}`] : []));
    }
    const mec = (v.verificacao?.pendencias ?? []).filter((p) => p.tipo === 'mecanica');
    L.push('', `### Mecânicas que ficaram em ${v.id} (${mec.length})`, '');
    for (const p of mec) {
      conta(totais.mecanicas, p.regra);
      L.push(`- **${p.regra}** – ${p.secao}: ${curto(p.trecho, 300)}`);
    }
    L.push('');
  }
}
const lista = (o) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') || 'nenhuma';
L.splice(4, 0, '## Totais', '', `- Mantidas por tipo: ${lista(totais.mantidas)}`, `- Estrutura por tratamento: ${lista(totais.estrutura)}`, `- Mecânicas que ficaram: ${lista(totais.mecanicas)}`, '');
writeFileSync(saida, L.join('\n'));
console.log(`${saida}: ${Math.round(L.join('\n').length / 1024)} KB`);
process.exit(0);
