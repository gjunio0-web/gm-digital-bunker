// Server-side validation of a submission, same rules as the client (ContactForm.astro).
// Pure functions: no Firebase imports, so they can be unit tested.

export const CARGOS = ['owner', 'ceo', 'director', 'manager', 'specialist', 'external', 'other'] as const;
export type Cargo = (typeof CARGOS)[number];
export const IDIOMAS = ['pt-BR', 'en'] as const;
export type Idioma = (typeof IDIOMAS)[number];

export const CAMPOS = ['nome', 'empresa', 'cargo', 'email', 'site', 'mensagem'] as const;
export type Campo = (typeof CAMPOS)[number];

const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITES = { nome: 120, empresa: 160, email: 254, site: 300, mensagem: 4000 } as const;

// Fields exactly as received: only surrounding whitespace is trimmed; empty optional fields are null.
export interface Original {
  nome: string;
  empresa: string;
  cargo: Cargo;
  email: string;
  site: string | null;
  mensagem: string | null;
  lang: Idioma;
}

// Normalized copies kept apart from the original (spec 01, principle 3).
export interface Normalizado {
  email: string;
  site: string | null;
}

export type Resultado =
  | { ok: true; original: Original; normalizado: Normalizado; pagina: string | null }
  | { ok: false; erros: Campo[] };

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// Website: optional; the scheme may be omitted. Returns the URL with scheme, or null when invalid.
export function normalizaSite(v: string): string | null {
  if (/\s/.test(v)) return null;
  const comEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(comEsquema);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')) return comEsquema;
  } catch {
    /* invalid URL */
  }
  return null;
}

// Page path sent by the form: a site path only (starts with one slash), at most 200 characters.
export function normalizaPagina(v: unknown): string | null {
  const p = texto(v);
  return /^\/(?!\/)[^\s]{0,199}$/.test(p) ? p : null;
}

export function valida(corpo: unknown): Resultado {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const nome = texto(c.nome);
  const empresa = texto(c.empresa);
  const cargo = texto(c.cargo);
  const email = texto(c.email);
  const site = texto(c.site);
  const mensagem = texto(c.mensagem);
  const lang = (IDIOMAS as readonly string[]).includes(c.lang as string) ? (c.lang as Idioma) : 'pt-BR';

  const siteNormalizado = site === '' ? null : normalizaSite(site);
  const erros: Campo[] = [];
  if (!nome || nome.length > LIMITES.nome) erros.push('nome');
  if (!empresa || empresa.length > LIMITES.empresa) erros.push('empresa');
  if (!(CARGOS as readonly string[]).includes(cargo)) erros.push('cargo');
  if (!RX_EMAIL.test(email) || email.length > LIMITES.email) erros.push('email');
  if ((site !== '' && siteNormalizado === null) || site.length > LIMITES.site) erros.push('site');
  if (mensagem.length > LIMITES.mensagem) erros.push('mensagem');
  if (erros.length) return { ok: false, erros };

  return {
    ok: true,
    original: { nome, empresa, cargo: cargo as Cargo, email, site: site || null, mensagem: mensagem || null, lang },
    normalizado: { email: email.toLowerCase(), site: siteNormalizado },
    pagina: normalizaPagina(c.pagina),
  };
}

// Honeypot: any content in the hidden field marks the submission as automated.
export const ehRobo = (corpo: unknown): boolean =>
  texto((corpo as Record<string, unknown> | null)?.['empresa-site']) !== '';
