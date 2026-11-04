// Reads config/pipeline with a short in-memory cache per instance, falling back to the defaults.
import { getFirestore } from 'firebase-admin/firestore';
import { PIPELINE_PADRAO, type Pipeline } from './config.js';

const CACHE_MS = 60_000;
let cache: { valor: Pipeline; em: number } | null = null;

export async function lePipeline(): Promise<Pipeline> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.valor;
  const snap = await getFirestore().doc('config/pipeline').get();
  const valor = { ...PIPELINE_PADRAO, ...(snap.exists ? snap.data() : {}) } as Pipeline;
  cache = { valor, em: Date.now() };
  return valor;
}
