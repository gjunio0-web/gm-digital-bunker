// Reads config/pipeline with a short in-memory cache per instance, falling back to the defaults.
import { getFirestore } from 'firebase-admin/firestore';
import { FORNECEDORES, PIPELINE_PADRAO, type Pipeline } from './config.js';

const CACHE_MS = 60_000;
let cache: { valor: Pipeline; em: number } | null = null;

// Merges the stored document over the defaults. fontes is merged per provider and per field, so a
// document that sets only part of a provider keeps the defaults for the rest.
export function combinaPipeline(dados: Record<string, unknown> = {}): Pipeline {
  const { fontes, ...resto } = dados as { fontes?: Record<string, Record<string, unknown>> };
  const combinadas = Object.fromEntries(
    FORNECEDORES.map((f) => [f, { ...PIPELINE_PADRAO.fontes[f], ...(fontes?.[f] ?? {}) }]),
  );
  return { ...PIPELINE_PADRAO, ...resto, fontes: combinadas } as Pipeline;
}

export async function lePipeline(): Promise<Pipeline> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.valor;
  const snap = await getFirestore().doc('config/pipeline').get();
  const valor = combinaPipeline(snap.exists ? snap.data() : {});
  cache = { valor, em: Date.now() };
  return valor;
}
