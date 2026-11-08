// One-off and re-runnable: writes config/pipeline with the spec 01 defaults and an empty config/metodo.
// Usage (from functions/, with gcloud credentials for the project):
//   npm run seed -- gmdb-qualidade
// Existing documents are never overwritten (they are adjustable without deploy and may have been
// edited): only fields missing from config/pipeline are added, e.g. the fontes block of spec 01 v0.3.
// config/precos (spec 01 v0.11) is only created when missing, never completed: prices change by a new version.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PIPELINE_PADRAO } from './config.js';
import { camposAusentes } from './seedCampos.js';
import { PRECOS_INICIAIS } from './precosIniciais.js';

const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: npm run seed -- <project id>');
  process.exit(1);
}
initializeApp({ projectId });
const db = getFirestore();

for (const [caminho, dados] of [
  ['config/pipeline', PIPELINE_PADRAO as unknown as Record<string, unknown>],
  ['config/metodo', {}],
  ['config/precos', PRECOS_INICIAIS as unknown as Record<string, unknown>],
] as const) {
  const ref = db.doc(caminho);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.create(dados);
    console.log(`${caminho}: created`);
    continue;
  }
  if (caminho === 'config/precos') {
    console.log(`${caminho}: exists, left unchanged`);
    continue;
  }
  const faltam = camposAusentes(dados, snap.data() ?? {});
  if (!Object.keys(faltam).length) {
    console.log(`${caminho}: already complete, left unchanged`);
    continue;
  }
  await ref.update(faltam);
  console.log(`${caminho}: added ${Object.keys(faltam).join(', ')}`);
}
