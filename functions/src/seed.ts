// One-off: writes config/pipeline with the spec 01 defaults and an empty config/metodo.
// Usage (from functions/, with gcloud credentials for the project):
//   npm run seed -- gmdb-qualidade
// Refuses to overwrite existing documents: they are adjustable without deploy and may have been edited.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PIPELINE_PADRAO } from './config.js';

const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: npm run seed -- <project id>');
  process.exit(1);
}
initializeApp({ projectId });
const db = getFirestore();

for (const [caminho, dados] of [
  ['config/pipeline', { ...PIPELINE_PADRAO }],
  ['config/metodo', {}],
] as const) {
  try {
    await db.doc(caminho).create(dados);
    console.log(`${caminho}: created`);
  } catch (e) {
    if ((e as { code?: number }).code === 6) console.log(`${caminho}: already exists, left unchanged`);
    else throw e;
  }
}
