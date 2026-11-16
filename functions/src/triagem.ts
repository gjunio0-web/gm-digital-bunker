// Triagem tail shared by coletarMinima (first pass) and retomarTriagem (re-run asked by acaoAdmin):
// qualificar (optional) → graduar (triagem), then the daily-ceiling notice when graduar asks for it.
import { logger } from 'firebase-functions';
import type { DocumentReference } from 'firebase-admin/firestore';
import type { Pipeline } from './config.js';
import { avisoTeto } from './email.js';
import { noEmulador } from './claude.js';
import { qualifica } from './qualificar.js';
import { graduaTriagem } from './graduar.js';

// `marca` receives the name of the step about to run, so the caller can write erro.etapa if it throws.
export async function concluiTriagem(
  ref: DocumentReference, id: string, p: Pipeline, chaves: { claude: string; smtp: string }, comQualificar: boolean, marca: (etapa: 'qualificar' | 'graduar') => void,
) {
  let decisao = null;
  if (comQualificar) {
    marca('qualificar');
    decisao = await qualifica(ref, p, chaves.claude);
  }
  marca('graduar');
  const g = await graduaTriagem(ref, p);
  if (g?.avisarTeto) {
    await avisoTeto(noEmulador() ? '' : chaves.smtp, g.avisarTeto.teto, g.avisarTeto.dia).catch((e) =>
      logger.error('triagem: ceiling notice failed', { id, mensagem: String((e as Error)?.message ?? e).slice(0, 300) }));
  }
  return { decisao, g };
}
