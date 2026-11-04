// expurgar – daily at 03:00 (São Paulo), deletes every ficha whose expurgoEm has passed, with all
// its subcollections (spec 01, sections 4 and 6). Minimal version for item 1: metricas comes later.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGIAO } from './config.js';

const LOTE = 100;

export async function expurgaVencidas(agora = Timestamp.now()): Promise<number> {
  const db = getFirestore();
  let total = 0;
  for (;;) {
    const vencidas = await db.collection('fichas').where('expurgoEm', '<', agora).limit(LOTE).get();
    if (vencidas.empty) break;
    for (const doc of vencidas.docs) await db.recursiveDelete(doc.ref);
    total += vencidas.size;
    if (vencidas.size < LOTE) break;
  }
  return total;
}

export const expurgar = onSchedule(
  { region: REGIAO, schedule: '0 3 * * *', timeZone: 'America/Sao_Paulo', memory: '256MiB', timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const total = await expurgaVencidas();
    logger.info('Expurgo concluído', { fichasExcluidas: total });
  },
);
