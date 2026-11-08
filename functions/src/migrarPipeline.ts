// One-off migration of config/pipeline to spec 01 v0.11 (only with Gon's authorization): the old fields
// modeloColeta, modeloSintese, modeloRevisor and esforcoSintese become modelos.{etapa} and esforco.{etapa}
// with the values in force (qualificar and coleta from modeloColeta, the three synthesis stages from
// modeloSintese with the effort of esforcoSintese, revisor from modeloRevisor with low effort, decision of
// Gon, 8/11/2026; reparar and corrigir null: they inherit), plus limiarReparo and correcaoAtiva; then the old
// fields are deleted. Also creates config/precos from the initial table when it is missing.
// Usage (from functions/): npm run migrar-pipeline -- gmdb-qualidade            (shows the plan only)
//                          npm run migrar-pipeline -- gmdb-qualidade --aplicar  (applies it)
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ETAPAS_MODELO, PIPELINE_PADRAO } from './config.js';
import { PRECOS_INICIAIS } from './precosIniciais.js';
import { planoMigracao } from './migracao.js';

const [projectId, ...flags] = process.argv.slice(2);
if (!projectId) {
  console.error('Usage: npm run migrar-pipeline -- <project id> [--aplicar]');
  process.exit(1);
}
const aplicar = flags.includes('--aplicar');
initializeApp({ projectId });
const db = getFirestore();

const ref = db.doc('config/pipeline');
const atual = (await ref.get()).data();
if (!atual) throw new Error('config/pipeline is missing: run the seed first');
const { campos, antigos } = planoMigracao(atual, ETAPAS_MODELO, PIPELINE_PADRAO);
console.log('config/pipeline, fields to set:');
for (const [k, v] of Object.entries(campos)) console.log(`  ${k} = ${JSON.stringify(v)}`);
console.log(`config/pipeline, fields to delete: ${antigos.join(', ') || '(none)'}`);

const precos = db.doc('config/precos');
const temPrecos = (await precos.get()).exists;
console.log(`config/precos: ${temPrecos ? 'exists, left unchanged' : `to create (versao ${PRECOS_INICIAIS.versao})`}`);

if (!aplicar) {
  console.log('Plan only; run again with --aplicar to apply it.');
  process.exit(0);
}
await ref.update({ ...campos, ...Object.fromEntries(antigos.map((k) => [k, FieldValue.delete()])) });
if (!temPrecos) await precos.create(PRECOS_INICIAIS);
console.log('Applied.');
