// expurgar – daily at 03:00 (São Paulo), deletes every ficha whose expurgoEm has passed, with all
// its subcollections (spec 01, sections 4 and 6), then cleans `controle` (spec 01 v0.34): the `retidas` of each daily
// counter older than 30 days goes to metricas/{aaaa-mm}.retidasTeto and the counter is deleted.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { DIA_MS, REGIAO } from './config.js';

const LOTE = 100;

// Removes a ficha with every subcollection (coleta, analise, eventos). Shared by the daily purge and by
// acaoAdmin (arquivar with expurgoImediato, spec 01, section 4.1, item 7). Nothing in metricas changes here: the other
// functions write their aggregates when each event happens, and metricas survives the purge.
export async function expurgarFicha(db: Firestore, ref: DocumentReference): Promise<void> {
  await db.recursiveDelete(ref);
}

export async function expurgaVencidas(agora = Timestamp.now()): Promise<number> {
  const db = getFirestore();
  let total = 0;
  for (;;) {
    const vencidas = await db.collection('fichas').where('expurgoEm', '<', agora).limit(LOTE).get();
    if (vencidas.empty) break;
    for (const doc of vencidas.docs) await expurgarFicha(db, doc.ref);
    total += vencidas.size;
    if (vencidas.size < LOTE) break;
  }
  return total;
}

// Day of a controle document id `analises-aaaa-mm-dd` (a real calendar day, São Paulo time), or null for any other id.
export function diaDoControle(id: string): string | null {
  const m = /^analises-(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const DIAS_CONTROLE = 30;

// "More than 30 days" counted from the day of the id to today in São Paulo.
export function controleVencido(dia: string, agora: Date): boolean {
  const hoje = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return (Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${dia}T00:00:00Z`)) / DIA_MS > DIAS_CONTROLE;
}

const POR_LOTE = 200;

// Sums `retidas` of the daily counters older than 30 days into metricas/{aaaa-mm}.retidasTeto (month of the day of
// the id) and deletes them; each batch holds the sums and the deletes together, so a failed batch changes nothing and
// the next run repeats it. Documents of `controle` with any other id are left alone; a counter without `retidas` is
// deleted without adding anything.
export async function limpaControle(db: Firestore, agora = new Date()): Promise<{ apagados: number; retidas: number }> {
  const todos = await db.collection('controle').select('retidas').get();
  const vencidos = todos.docs.filter((d) => {
    const dia = diaDoControle(d.id);
    return dia !== null && controleVencido(dia, agora);
  });
  let retidas = 0;
  for (let i = 0; i < vencidos.length; i += POR_LOTE) {
    const parte = vencidos.slice(i, i + POR_LOTE);
    const porMes = new Map<string, number>();
    for (const d of parte) {
      const n = Number(d.get('retidas'));
      const mes = (diaDoControle(d.id) as string).slice(0, 7);
      if (Number.isFinite(n) && n > 0) porMes.set(mes, (porMes.get(mes) ?? 0) + n);
    }
    const lote = db.batch();
    for (const [mes, n] of porMes) lote.set(db.collection('metricas').doc(mes), { retidasTeto: FieldValue.increment(n), atualizadoEm: Timestamp.fromDate(agora) }, { merge: true });
    for (const d of parte) lote.delete(d.ref);
    await lote.commit();
    for (const n of porMes.values()) retidas += n;
  }
  return { apagados: vencidos.length, retidas };
}

export const expurgar = onSchedule(
  { region: REGIAO, schedule: '0 3 * * *', timeZone: 'America/Sao_Paulo', memory: '256MiB', timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const total = await expurgaVencidas();
    logger.info('Expurgo concluído', { fichasExcluidas: total });
    const c = await limpaControle(getFirestore());
    logger.info('Limpeza de controle concluída', { contadoresApagados: c.apagados, retidasSomadas: c.retidas });
  },
);
