// Estimated cost of Claude API calls, from the usage returned by the API and the price table in
// config/precos (spec 01 v0.11), never a constant in code. Prices in US$ per million tokens; a model with
// acimaDe moves the whole request to the higher price when its prompt (input + cache writes + cache reads)
// exceeds acimaDe.tokens (Haiku 5.5 over 100,000 tokens). Web search priced per 1,000 searches
// (precos.buscaWeb.porMil, decision of Gon, 8/11/2026). Without the table, or with a model missing from it,
// usdEstimado is null. The calculation is the one of commit 01ce19d, only the table moved.
export interface Uso {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  // Usage of each API response when several were summed (collection with pause_turn or a correction):
  // the tier is decided per response.
  partes?: Uso[];
}

export interface Preco { entrada: number; saida: number; cacheLeitura: number; cacheGravacao: number }
export interface Precos {
  versao: string;
  vigenteDesde: string;
  modelos: Record<string, Preco & { acimaDe?: { tokens: number; preco: Preco } | null }>;
  buscaWeb?: { porMil: number } | null;
}

// Usd of the tokens; semCache prices cache reads and writes as plain input (the same request without cache).
function usdDe(t: Precos | null, modelo: string, u: Uso, semCache = false): number | null {
  if (u.partes?.length) {
    let s = 0;
    for (const x of u.partes) {
      const v = usdDe(t, modelo, x, semCache);
      if (v === null) return null;
      s += v;
    }
    return s;
  }
  const p = t?.modelos?.[modelo];
  if (!p) return null;
  const escrita = u.cache_creation_input_tokens ?? 0;
  const leitura = u.cache_read_input_tokens ?? 0;
  const q = p.acimaDe && u.input_tokens + escrita + leitura > p.acimaDe.tokens ? p.acimaDe.preco : p;
  return semCache
    ? ((u.input_tokens + escrita + leitura) * q.entrada + u.output_tokens * q.saida) / 1e6
    : (u.input_tokens * q.entrada + escrita * q.cacheGravacao + leitura * q.cacheLeitura + u.output_tokens * q.saida) / 1e6;
}

export interface Custo {
  // Input outside the cache; cacheLidos and cacheEscritos apart (spec 01 v0.11, uso).
  tokensEntrada: number;
  cacheLidos: number;
  cacheEscritos: number;
  tokensSaida: number;
  buscas: number;
  usdEstimado: number | null;
  usdSemCache: number | null;
  versaoPrecos: string | null;
}

const arredonda = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6);

export function custoDe(tabela: Precos | null, modelo: string, u: Uso, buscas = 0): Custo {
  const busca = buscas ? (tabela?.buscaWeb?.porMil ?? null) : 0;
  const soma = (v: number | null) => (v === null || busca === null ? null : v + (buscas * (busca ?? 0)) / 1000);
  return {
    tokensEntrada: u.input_tokens,
    cacheLidos: u.cache_read_input_tokens ?? 0,
    cacheEscritos: u.cache_creation_input_tokens ?? 0,
    tokensSaida: u.output_tokens,
    buscas,
    usdEstimado: arredonda(soma(usdDe(tabela, modelo, u))),
    usdSemCache: arredonda(soma(usdDe(tabela, modelo, u, true))),
    versaoPrecos: tabela?.versao ?? null,
  };
}

// The whole prompt (input + cache reads + cache writes): what the ficha's custo.tokensEntrada and the
// collection stages keep counting, as before.
export const promptTotal = (k: Pick<Custo, 'tokensEntrada' | 'cacheLidos' | 'cacheEscritos'>) => k.tokensEntrada + k.cacheLidos + k.cacheEscritos;
