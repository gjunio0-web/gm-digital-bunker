// Publications cards, generated at build time from the AI Strategy Hub (spec 06).
//
// The Hub is the single source of every article: artigos/index.json holds id, slug, category,
// reading time, publication date and the PT title and summary; i18n/en.json holds the EN title and
// summary under articles.<id>.title / .dek. Texts are used exactly as the Hub publishes them.
//
// HUB follows the build environment (src/config.ts): production reads the production Hub, every other
// build reads the Hub's quality_env deploy.
//
// Any problem (network, invalid JSON, empty list, missing field or missing EN text) fails the build
// on purpose: Netlify then keeps the last published version online, so no page ships broken cards.
import { HUB } from '../config';

export type Artigo = { titulo: string; resumo: string; url: string };

type Entrada = { id: string; slug: string; cat: string; min: number; data: string; title: string; dek: string };
type Manifesto = { versao: number; artigos: Entrada[] };
type Dicionario = Record<string, { text: string; sourceHash?: string }>;

async function lerJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`[artigos] could not reach ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`[artigos] ${url} answered HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new Error(`[artigos] ${url} is not valid JSON: ${(e as Error).message}`);
  }
}

// One fetch per build, shared by the PT and EN pages.
let manifesto: Promise<Entrada[]> | null = null;
let ingles: Promise<Dicionario> | null = null;

function carregarManifesto(): Promise<Entrada[]> {
  manifesto ??= lerJson<Manifesto>(`${HUB}/artigos/index.json`).then((m) => {
    const lista = Array.isArray(m?.artigos) ? m.artigos : [];
    if (!lista.length) throw new Error(`[artigos] ${HUB}/artigos/index.json has no articles`);
    for (const a of lista) {
      for (const campo of ['id', 'slug', 'data', 'title', 'dek'] as const) {
        if (!a[campo]) throw new Error(`[artigos] article ${a.id ?? '?'} has no "${campo}" in the Hub manifest`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.data)) throw new Error(`[artigos] article ${a.id}: date "${a.data}" is not YYYY-MM-DD`);
    }
    return lista;
  });
  return manifesto;
}

// Most recent first: by date, descending; on the same date, later in the manifest comes first
// (the manifest lists articles in publication order).
function ordenar(lista: Entrada[]): Entrada[] {
  return lista
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.data === y.a.data ? y.i - x.i : x.a.data < y.a.data ? 1 : -1))
    .map((x) => x.a);
}

// Publication date (YYYY-MM-DD) of the most recent article in the Hub manifest. The Publications pages
// pass it to the layout, so the page's structured-data dateModified follows new articles automatically.
export async function ultimaPublicacao(): Promise<string> {
  return (await carregarManifesto()).reduce((max, a) => (a.data > max ? a.data : max), '');
}

export async function artigosDoHub(lang?: 'en'): Promise<Artigo[]> {
  const lista = ordenar(await carregarManifesto());
  if (lang !== 'en') {
    return lista.map((a) => ({
      titulo: a.title,
      resumo: a.dek,
      url: `${HUB}/?tab=articles&artigo=${a.slug}`,
    }));
  }
  ingles ??= lerJson<Dicionario>(`${HUB}/i18n/en.json`);
  const en = await ingles;
  return lista.map((a) => {
    const titulo = en[`articles.${a.id}.title`]?.text;
    const resumo = en[`articles.${a.id}.dek`]?.text;
    if (!titulo || !resumo) throw new Error(`[artigos] article ${a.id} has no English title or summary in the Hub's i18n/en.json`);
    return { titulo, resumo, url: `${HUB}/?lang=en&tab=articles&artigo=${a.slug}` };
  });
}
