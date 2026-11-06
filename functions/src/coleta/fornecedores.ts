// Licensed sources (spec 03, sections 4 and 5): Apollo (company by domain), Apify (company
// Instagram profile), Hunter (signer by corporate e-mail). Each returns only the fields the specs
// allow; everything else is dropped here, before anything reaches the model or Firestore.
import { chamaJson } from './rede.js';

export interface Apollo {
  funcionariosEstimados: number | null;
  setorFornecedor: string | null;
  localizacao: string | null;
}

export async function consultaApollo(chave: string, dominio: string): Promise<{ status: number; dados: Apollo | null }> {
  const { status, corpo } = await chamaJson(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(dominio)}`, {
    headers: { 'x-api-key': chave, 'cache-control': 'no-cache', accept: 'application/json' },
  });
  const o = (corpo as { organization?: Record<string, unknown> } | null)?.organization;
  if (status !== 200 || !o) return { status, dados: null };
  const loc = [o.city, o.state, o.country].filter((x) => typeof x === 'string' && x).join(', ');
  return {
    status,
    dados: {
      funcionariosEstimados: typeof o.estimated_num_employees === 'number' ? o.estimated_num_employees : null,
      setorFornecedor: typeof o.industry === 'string' ? o.industry : null,
      localizacao: loc || null,
    },
  };
}

export interface Instagram {
  perfil: string;
  seguidores: number | null;
  publicacoes: number | null;
  bio: string | null;
  nome: string | null;
  legendasRecentes: string[];
}

export async function consultaApify(token: string, usuario: string): Promise<{ status: number; dados: Instagram | null }> {
  const { status, corpo } = await chamaJson(
    'https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?timeout=90',
    { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ usernames: [usuario] }) },
    120_000,
  );
  const item = Array.isArray(corpo) ? (corpo[0] as Record<string, unknown> | undefined) : undefined;
  if (status < 200 || status >= 300 || !item || item.error) return { status, dados: null };
  const posts = Array.isArray(item.latestPosts) ? (item.latestPosts as Record<string, unknown>[]) : [];
  return {
    status,
    dados: {
      perfil: typeof item.username === 'string' ? item.username : usuario,
      seguidores: typeof item.followersCount === 'number' ? item.followersCount : null,
      publicacoes: typeof item.postsCount === 'number' ? item.postsCount : null,
      bio: typeof item.biography === 'string' ? item.biography.slice(0, 300) : null,
      nome: typeof item.fullName === 'string' ? item.fullName : null,
      legendasRecentes: posts.map((p) => (typeof p.caption === 'string' ? p.caption.slice(0, 280) : '')).filter(Boolean).slice(0, 6),
    },
  };
}

// Hunter fields allowed by spec 03, table 5.1; phone, social handles, bio, photo and the rest are dropped.
export interface Hunter {
  cargo: string | null;
  funcao: string | null;
  subfuncao: string | null;
  senioridade: string | null;
  empresaAtual: string | null;
  dominioEmpresa: string | null;
  cidade: string | null;
  estado: string | null;
  pais: string | null;
}

export function filtraHunter(d: Record<string, unknown>): Hunter {
  const e = (d.employment ?? {}) as Record<string, unknown>;
  const g = (d.geo ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    cargo: s(e.title), funcao: s(e.role), subfuncao: s(e.subRole), senioridade: s(e.seniority),
    empresaAtual: s(e.name), dominioEmpresa: s(e.domain), cidade: s(g.city), estado: s(g.state), pais: s(g.country),
  };
}

export async function consultaHunter(chave: string, email: string): Promise<{ status: number; dados: Hunter | null }> {
  const { status, corpo } = await chamaJson(`https://api.hunter.io/v2/people/find?email=${encodeURIComponent(email)}`, { headers: { 'X-API-KEY': chave } });
  const d = (corpo as { data?: Record<string, unknown> } | null)?.data;
  return { status, dados: status === 200 && d ? filtraHunter(d) : null };
}
