// Reads config/precos (spec 01 v0.11) with a short in-memory cache per instance, like config/pipeline.
// Missing document: null, so costs stay null and the log says why.
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { Precos } from './custo.js';

const CACHE_MS = 60_000;
let cache: { valor: Precos | null; em: number } | null = null;

export async function lePrecos(): Promise<Precos | null> {
  if (cache && Date.now() - cache.em < CACHE_MS && process.env.FUNCTIONS_EMULATOR !== 'true') return cache.valor;
  const snap = await getFirestore().doc('config/precos').get();
  const valor = snap.exists ? (snap.data() as Precos) : null;
  if (!valor) logger.warn('config/precos is missing: costs are not estimated');
  cache = { valor, em: Date.now() };
  return valor;
}
