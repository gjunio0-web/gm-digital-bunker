// Real check of acaoAdmin reexecutar (alvos sintese and qualificacao) and of the retomarTriagem trigger against a
// real project (quality tool; never run against gmdb-producao). The action logic runs in-process (executaAcao,
// with the uid of the admin user), so no sign-in is needed; the triggers that follow are the deployed ones.
// Usage (from functions/, in Cloud Shell): node scripts/verifica-5b2.mjs gmdb-qualidade [graduar] [qualificar] [sintese]
// graduar    – copy of a test ficha stopped by erro.etapa = graduar (no model call; the triagem is redone)
// qualificar – copy of a test ficha stopped by erro.etapa = qualificar (one Haiku call, then the triagem)
// sintese    – re-runs the synthesis of a test ficha in analise_pronta (full synthesis and verification: model calls)
// Report without personal data.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { executaAcao } from '../lib/acaoAdmin.js';
import { lePipeline } from '../lib/pipeline.js';

const [projeto, ...cenarios] = process.argv.slice(2);
if (!projeto || projeto === 'gmdb-producao' || cenarios.length === 0) {
  console.error('Usage: node scripts/verifica-5b2.mjs <project id, not production> graduar|qualificar|sintese …');
  process.exit(1);
}
initializeApp({ projectId: projeto });
const db = getFirestore();
const dorme = (s) => new Promise((r) => setTimeout(r, s * 1000));
const linha = (...a) => console.log(...a);

const admin = (await db.collection('usuarios').where('papel', '==', 'admin').limit(1).get()).docs[0];
if (!admin) { console.error('No admin user in usuarios'); process.exit(1); }
const p = await lePipeline();
const age = (fichaId, alvo) => executaAcao(db, p, { uid: admin.id, fichaId, acao: 'reexecutar', parametros: { alvo } });
const tipos = async (id) => (await db.collection(`fichas/${id}/eventos`).orderBy('em').get()).docs.map((d) => d.get('tipo'));
const ms = (t) => (t && t.toMillis ? t.toMillis() : null);

// Waits until fn() returns something truthy or the time is over; prints a dot a minute.
async function espera(fn, minutos) {
  for (let i = 0; i < minutos * 6; i++) {
    const r = await fn();
    if (r) return r;
    await dorme(10);
    if (i % 6 === 5) process.stdout.write('.');
  }
  return null;
}

// A copy of a test ficha that the triagem sent away from the analysis (no collection follows), stopped as asked.
async function copiaParada(etapa) {
  const q = await db.collection('fichas').where('teste', '==', true).where('estado', 'in', ['resposta_breve', 'descartada']).limit(1).get();
  if (q.empty) { linha(`[${etapa}] no test ficha in resposta_breve/descartada to copy`); return null; }
  const origem = q.docs[0];
  const id = `verifica-${etapa}-${Date.now().toString(36)}`;
  const { lead, retencao, ...d } = origem.data();
  const agora = Timestamp.now();
  const campos = { ...d, estadoEm: agora, teste: true,
    erro: { etapa, mensagem: 'simulated stop for the check of retomarTriagem', em: agora } };
  if (etapa === 'graduar') campos.estado = 'qualificada';
  else {
    campos.estado = 'coleta_minima';
    campos.qualificacao = { dominioCorporativo: d.qualificacao?.dominioCorporativo ?? false, siteResolvido: d.qualificacao?.siteResolvido ?? null };
  }
  delete campos.lead; // the copy has no lead and no retencao: the triagem is what is missing
  await db.doc(`fichas/${id}`).set(campos);
  for (const e of ['empresa_digital', 'empresa_registro']) {
    const s = await origem.ref.collection('coleta').doc(e).get();
    if (s.exists) await db.doc(`fichas/${id}/coleta/${e}`).set(s.data());
  }
  return { id, de: origem.get('estado'), grauOriginal: lead?.grau ?? null, quadranteOriginal: lead?.quadrante ?? null };
}

async function triagem(etapa) {
  const c = await copiaParada(etapa);
  if (!c) return;
  linha(`[${etapa}] copy ${c.id} (original in ${c.de}, lead ${c.quadranteOriginal}/${c.grauOriginal})`);
  const antes = (await db.doc(`fichas/${c.id}`).get()).data();
  const sai = await age(c.id, ['qualificacao']);
  linha(`[${etapa}] action ok, estado ${sai.estado}`);
  const f = await espera(async () => {
    const x = (await db.doc(`fichas/${c.id}`).get()).data();
    return x.lead && !x.erro ? x : x.erro && x.erro.etapa !== etapa ? x : null;
  }, 4);
  if (!f) { linha(`[${etapa}] TIMEOUT: no lead after 4 min`); return; }
  linha(`\n[${etapa}] estado ${f.estado}; erro ${f.erro ? `${f.erro.etapa}: ${String(f.erro.mensagem).slice(0, 80)}` : 'none'}`);
  linha(`[${etapa}] lead ${f.lead?.quadrante}/${f.lead?.grau}/${f.lead?.destino}; estadoEm renewed: ${ms(f.estadoEm) > ms(antes.estadoEm)}`);
  linha(`[${etapa}] events: ${(await tipos(c.id)).join(', ')}`);
}

async function sintese() {
  const q = await db.collection('fichas').where('teste', '==', true).where('estado', '==', 'analise_pronta').limit(1).get();
  if (q.empty) { linha('[sintese] no test ficha in analise_pronta'); return; }
  const id = q.docs[0].id;
  const antes = q.docs[0].data();
  linha(`[sintese] ficha ${id}, analiseAtual ${antes.analiseAtual}, prazoEm ${ms(antes.lead?.acao?.prazoEm)}`);
  const sai = await age(id, ['sintese']);
  linha(`[sintese] action ok, estado ${sai.estado}, analiseAtual ${sai.analiseAtual}`);
  const f = await espera(async () => {
    const x = (await db.doc(`fichas/${id}`).get()).data();
    if (x.erro) return x;
    return ['analise_pronta', 'analise_com_pendencias'].includes(x.estado) && x.analiseAtual !== antes.analiseAtual ? x : null;
  }, 14);
  if (!f) { linha('\n[sintese] TIMEOUT after 14 min'); return; }
  linha(`\n[sintese] estado ${f.estado}; analiseAtual ${f.analiseAtual}; erro ${f.erro ? `${f.erro.etapa}: ${String(f.erro.mensagem).slice(0, 80)}` : 'none'}`);
  linha(`[sintese] prazoEm kept: ${ms(f.lead?.acao?.prazoEm) === ms(antes.lead?.acao?.prazoEm)} (${ms(f.lead?.acao?.prazoEm)})`);
  const v = (await db.doc(`fichas/${id}/analise/${f.analiseAtual}`).get()).data();
  linha(`[sintese] new version autor ${v?.autor?.tipo}/${v?.autor?.origem}; verificacao ${v?.verificacao?.status ?? 'pending'}; usd ${v?.uso?.total?.usdEstimado ?? 'n/a'}`);
  linha(`[sintese] events: ${(await tipos(id)).join(', ')}`);
}

for (const c of cenarios) {
  if (c === 'graduar' || c === 'qualificar') await triagem(c);
  else if (c === 'sintese') await sintese();
  else linha(`unknown scenario ${c}`);
}
linha('FIM');
process.exit(0);
