// How the multi-item subsections were written in given rounds: for each B2 ficha and design, the start of
// every paragraph of s3 and s6 in the first version of the round (before the correction). Read-only; used to
// check whether the "(n)" numbering of round R1g replaced one label per item in earlier rounds.
// Usage: node scripts/subsecoes-rodadas.mjs <project id> <rounds, e.g. R1f,R1g> <output.md>
import { writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FICHAS_B2, desenhoDe, rodadaDe } from './b2-rodadas.mjs';

const [projeto, rodadas, saida] = process.argv.slice(2);
if (!projeto || !rodadas || !saida) {
  console.error('Usage: node scripts/subsecoes-rodadas.mjs <project id> <rounds> <output.md>');
  process.exit(1);
}
const alvo = rodadas.split(',');
initializeApp({ projectId: projeto });
const db = getFirestore();
db.settings({ preferRest: true });

const L = [`# Parágrafos de s3 e s6 – ${alvo.join(', ')}`, ''];
for (const id of FICHAS_B2) {
  const ref = db.collection('fichas').doc(id);
  const f = await ref.get();
  if (!f.exists) continue;
  const versoes = (await ref.collection('analise').get()).docs.map((d) => {
    const x = d.data();
    return { id: d.id, n: Number(d.id.slice(1)), ...x, origem: x.autor?.origem ?? null, criadaEm: x.criadaEm?.toDate?.().toISOString() ?? null };
  }).sort((a, b) => a.n - b.n);
  for (const v of versoes.filter((x) => x.origem !== 'correcao' && x.autor?.tipo !== 'humano')) {
    const rodada = rodadaDe(id, v, versoes);
    if (!alvo.includes(rodada)) continue;
    L.push(`## ${f.get('original.empresa')} – ${rodada} – desenho ${desenhoDe(v.uso?.montar_analise?.modelo)} – ${v.id}`, '');
    for (const s of ['s3', 's6']) {
      const ps = (v.secoes?.[s]?.corpo ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      L.push(`${s}:`);
      for (const p of ps) L.push(`  - ${p.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
    L.push('');
  }
}
writeFileSync(saida, L.join('\n'));
console.log(`${saida}: ${Math.round(L.join('\n').length / 1024)} KB`);
process.exit(0);
