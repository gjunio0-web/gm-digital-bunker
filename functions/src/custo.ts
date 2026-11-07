// Estimated cost of Claude API calls, from the usage returned by the API.
// Web search: US$ 10 per 1,000 searches (Claude docs, web search tool); web fetch: tokens only.
// Prices in US$ per million tokens: Haiku 5.5 for prompts up to 100k tokens (Claude docs, Haiku 5.5 overview,
// 5/11/2026); Sonnet 5.5 with a single tier, 5-minute cache writes (Claude docs, Sonnet 5.5 overview, 7/11/2026).
// A model missing from the table yields usdEstimado = null; prices are added with the phase that uses the model.
export interface Uso {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

const USD_POR_BUSCA = 0.01;

const PRECOS: Record<string, { entrada: number; saida: number; escritaCache: number; leituraCache: number }> = {
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, escritaCache: 0.125, leituraCache: 0.01 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, escritaCache: 2.5, leituraCache: 0.1 },
};

export interface Custo {
  tokensEntrada: number;
  tokensSaida: number;
  buscas: number;
  usdEstimado: number | null;
}

export function custoDe(modelo: string, u: Uso, buscas = 0): Custo {
  const escrita = u.cache_creation_input_tokens ?? 0;
  const leitura = u.cache_read_input_tokens ?? 0;
  const p = PRECOS[modelo];
  const usd = p
    ? (u.input_tokens * p.entrada + escrita * p.escritaCache + leitura * p.leituraCache + u.output_tokens * p.saida) / 1e6 + buscas * USD_POR_BUSCA
    : null;
  return {
    tokensEntrada: u.input_tokens + escrita + leitura,
    tokensSaida: u.output_tokens,
    buscas,
    usdEstimado: usd === null ? null : Math.round(usd * 1e6) / 1e6,
  };
}
