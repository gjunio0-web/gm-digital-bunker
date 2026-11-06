// Reads config/pipeline with a short in-memory cache per instance, falling back to the defaults.
import { getFirestore } from 'firebase-admin/firestore';
import { FORNECEDORES, PIPELINE_PADRAO, type Pipeline } from './config.js';

const CACHE_MS = 60_000;
let cache: { valor: Pipeline; em: number } | null = null;

type Mapa = Record<string, unknown>;
const ehMapa = (v: unknown): v is Mapa => typeof v === 'object' && v !== null && !Array.isArray(v);

// Stored values over the defaults, recursively for maps.
function funde(padrao: Mapa, dados: unknown): Mapa {
  if (!ehMapa(dados)) return padrao;
  const r: Mapa = { ...padrao };
  for (const [k, v] of Object.entries(dados)) r[k] = ehMapa(padrao[k]) ? funde(padrao[k] as Mapa, v) : v;
  return r;
}

// Merges the stored document over the defaults. fontes is merged per provider and per field, and
// pesosQualificacao per field at every level, so a document that sets only part keeps the defaults.
export function combinaPipeline(dados: Record<string, unknown> = {}): Pipeline {
  const { fontes, pesosQualificacao, ...resto } = dados as { fontes?: Record<string, Record<string, unknown>>; pesosQualificacao?: unknown };
  const combinadas = Object.fromEntries(
    FORNECEDORES.map((f) => [f, { ...PIPELINE_PADRAO.fontes[f], ...(fontes?.[f] ?? {}) }]),
  );
  const pesos = funde(PIPELINE_PADRAO.pesosQualificacao as unknown as Mapa, pesosQualificacao);
  return { ...PIPELINE_PADRAO, ...resto, fontes: combinadas, pesosQualificacao: pesos } as unknown as Pipeline;
}

export async function lePipeline(): Promise<Pipeline> {
  // No cache in the emulator, so a test can change the configuration between fichas.
  if (cache && Date.now() - cache.em < CACHE_MS && process.env.FUNCTIONS_EMULATOR !== 'true') return cache.valor;
  const snap = await getFirestore().doc('config/pipeline').get();
  const valor = combinaPipeline(snap.exists ? snap.data() : {});
  cache = { valor, em: Date.now() };
  return valor;
}
