// Usage of each model call in analise/vN.uso (spec 01 v0.11): model, effort, tokens with cache read and
// written apart, duration and estimated cost by the config/precos version in force, plus the totals.
// Pure functions.
import { custoDe, promptTotal, type Precos, type Uso } from './custo.js';

export interface UsoChamada {
  modelo: string;
  esforco: string;
  tokensEntrada: number;
  tokensSaida: number;
  cacheLidos: number;
  cacheEscritos: number;
  duracaoMs: number | null;
  usdEstimado: number | null;
  usdSemCache: number | null;
  versaoPrecos: string | null;
}

export function usoChamada(precos: Precos | null, modelo: string, esforco: string, uso: Uso | null, duracaoMs: number | null): UsoChamada {
  const k = custoDe(precos, modelo, uso ?? { input_tokens: 0, output_tokens: 0 });
  return {
    modelo, esforco,
    tokensEntrada: k.tokensEntrada, tokensSaida: k.tokensSaida, cacheLidos: k.cacheLidos, cacheEscritos: k.cacheEscritos,
    duracaoMs, usdEstimado: k.usdEstimado, usdSemCache: k.usdSemCache, versaoPrecos: k.versaoPrecos,
  };
}

export interface TotalUso {
  tokensEntrada: number;
  tokensSaida: number;
  cacheLidos: number;
  cacheEscritos: number;
  duracaoMs: number;
  usdEstimado: number;
  usdSemCache: number;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function totalDe(chamadas: UsoChamada[]): TotalUso {
  const t = chamadas.reduce(
    (s, c) => ({
      tokensEntrada: s.tokensEntrada + c.tokensEntrada, tokensSaida: s.tokensSaida + c.tokensSaida,
      cacheLidos: s.cacheLidos + c.cacheLidos, cacheEscritos: s.cacheEscritos + c.cacheEscritos,
      duracaoMs: s.duracaoMs + (c.duracaoMs ?? 0), usdEstimado: s.usdEstimado + (c.usdEstimado ?? 0), usdSemCache: s.usdSemCache + (c.usdSemCache ?? 0),
    }),
    { tokensEntrada: 0, tokensSaida: 0, cacheLidos: 0, cacheEscritos: 0, duracaoMs: 0, usdEstimado: 0, usdSemCache: 0 },
  );
  return { ...t, usdEstimado: r6(t.usdEstimado), usdSemCache: r6(t.usdSemCache) };
}

// The whole prompt of a set of calls, for the ficha's custo.tokensEntrada (kept with its old meaning).
export const promptDe = (chamadas: UsoChamada[]) => chamadas.reduce((s, c) => s + promptTotal(c), 0);
