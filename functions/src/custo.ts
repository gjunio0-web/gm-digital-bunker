// Estimated cost of Claude API calls, from the usage returned by the API.
// Web search: US$ 10 per 1,000 searches (Claude docs, web search tool); web fetch: tokens only.
// Prices in US$ per million tokens, 5-minute cache writes: Haiku 5.5 with two tiers – prompts up to 100,000
// tokens and prompts over 100,000 tokens, the whole request at the higher rate (Claude docs, Haiku 5.5
// overview, 7/11/2026); Sonnet 5.5 with a single tier (Claude docs, Sonnet 5.5 overview, 7/11/2026).
// The prompt of a request is input + cache writes + cache reads. A model missing from the table yields
// usdEstimado = null.
export interface Uso {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  // Usage of each API response when several were summed (collection with pause_turn or a correction):
  // the tier is decided per response.
  partes?: Uso[];
}

const USD_POR_BUSCA = 0.01;

interface Preco { entrada: number; saida: number; escritaCache: number; leituraCache: number }
const PRECOS: Record<string, Preco & { acimaDe?: { tokens: number; preco: Preco } }> = {
  'claude-haiku-5-5': {
    entrada: 0.1, saida: 0.5, escritaCache: 0.125, leituraCache: 0.01,
    acimaDe: { tokens: 100_000, preco: { entrada: 0.5, saida: 2.5, escritaCache: 0.625, leituraCache: 0.05 } },
  },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, escritaCache: 2.5, leituraCache: 0.1 },
};

function usdDe(modelo: string, u: Uso): number | null {
  if (u.partes?.length) {
    let t = 0;
    for (const x of u.partes) {
      const v = usdDe(modelo, x);
      if (v === null) return null;
      t += v;
    }
    return t;
  }
  const p = PRECOS[modelo];
  if (!p) return null;
  const escrita = u.cache_creation_input_tokens ?? 0;
  const leitura = u.cache_read_input_tokens ?? 0;
  const q = p.acimaDe && u.input_tokens + escrita + leitura > p.acimaDe.tokens ? p.acimaDe.preco : p;
  return (u.input_tokens * q.entrada + escrita * q.escritaCache + leitura * q.leituraCache + u.output_tokens * q.saida) / 1e6;
}

export interface Custo {
  tokensEntrada: number;
  tokensSaida: number;
  buscas: number;
  usdEstimado: number | null;
}

export function custoDe(modelo: string, u: Uso, buscas = 0): Custo {
  const escrita = u.cache_creation_input_tokens ?? 0;
  const leitura = u.cache_read_input_tokens ?? 0;
  const tokens = usdDe(modelo, u);
  const usd = tokens === null ? null : tokens + buscas * USD_POR_BUSCA;
  return {
    tokensEntrada: u.input_tokens + escrita + leitura,
    tokensSaida: u.output_tokens,
    buscas,
    usdEstimado: usd === null ? null : Math.round(usd * 1e6) / 1e6,
  };
}
