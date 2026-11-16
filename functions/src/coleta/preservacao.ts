// Preservation of the previous data on a re-run (spec 03, section 7.3; spec 01, coleta/{etapa}.preservado).
// Pure functions only (no Firestore, no provider call): the failure and merge tests are unit tests because
// pode() is false in the emulator. The engine (motor.ts) applies them.
import type { Afirmacao, FonteColeta } from './envelope.js';

export type Bloco = 'apollo' | 'instagram';

// What a provider call amounted to. "falha" preserves the previous block; the other two do not.
export type Resultado = 'encontrado' | 'nao_encontrado' | 'falha';

// Rule C1: no response (status 0, timeout included) or any response that is neither 2xx nor 404 is a failure
// (the safe side, which preserves). 404 and a 2xx without a match are "não encontrado": the provider answered,
// the new result stands. Apify success with an error profile arrives as 2xx without data: "não encontrado".
export function resultadoDe(status: number, dados: unknown): Resultado {
  if (!Number.isInteger(status) || status === 0) return 'falha';
  if (status >= 200 && status < 300) return dados ? 'encontrado' : 'nao_encontrado';
  if (status === 404) return 'nao_encontrado';
  return 'falha';
}

// Short, personal-data-free reason stored in preservado.falha.
export function motivoDaFalha(status: number): string {
  return status === 0 ? 'sem resposta do fornecedor (inclusive tempo esgotado)' : `resposta HTTP ${status}`;
}

// Normalized Instagram identifier: lower case, no "@", no instagram.com URL prefix, no trailing slash or query.
export function identificadorInstagram(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^@/, '');
  return s ? s : null;
}

// The Instagram block is preserved only when the previous profile is the one consulted now (spec 03 v1.18).
// "No profile determined now" (null) never matches, so nothing is preserved.
export function mesmoPerfil(anterior: unknown, agora: unknown): boolean {
  const a = identificadorInstagram(anterior);
  const b = identificadorInstagram(agora);
  return a !== null && b !== null && a === b;
}

// A block with Apify data (the previous run got the profile) is the only Instagram block worth preserving.
export function instagramTemDados(bloco: unknown): boolean {
  return Boolean(bloco) && typeof bloco === 'object' && typeof (bloco as Record<string, unknown>).seguidores === 'number';
}

// A previous Apollo block is worth preserving when it is an object (a string means "não consultado"/"sem correspondência").
export function apolloTemDados(bloco: unknown): boolean {
  return Boolean(bloco) && typeof bloco === 'object' && !Array.isArray(bloco);
}

// Which source of the list belongs to which block (urls the engine writes in empresa_digital).
export function ehFonteDoBloco(bloco: Bloco, f: Pick<FonteColeta, 'url'>): boolean {
  const u = String(f.url);
  return bloco === 'apollo' ? u.includes('api.apollo.io') : u.includes('instagram.com/');
}

export interface Parte {
  conteudo: Record<string, unknown>;
  fontes: FonteColeta[];
  afirmacoes: Afirmacao[];
}

// Merges the previous block into the new stage content (spec 03 v1.17): the block replaces the new one in
// conteudo; its sources go to the end of the new list with the original consultadoEm; the previous statements
// that pointed to those sources are carried over with the new index. Returns null when there is nothing to carry.
export function fundeBloco(novo: Parte, anterior: Parte, bloco: Bloco): { parte: Parte; desde: string | null } | null {
  const bl = anterior.conteudo?.[bloco];
  if (bl === undefined || bl === null) return null;
  const antigos = (anterior.fontes ?? []).map((f, i) => (ehFonteDoBloco(bloco, f) ? i : -1)).filter((i) => i >= 0);
  const mapa = new Map<number, number>();
  const fontes = [...novo.fontes];
  for (const i of antigos) mapa.set(i, fontes.push({ ...anterior.fontes[i] }) - 1);
  const afirmacoes = [...novo.afirmacoes];
  for (const a of anterior.afirmacoes ?? []) {
    const idx = (a.fonteIdx ?? []).filter((i) => mapa.has(i)).map((i) => mapa.get(i) as number);
    if (idx.length) afirmacoes.push({ ...a, fonteIdx: idx });
  }
  const datas = antigos.map((i) => anterior.fontes[i].consultadoEm).filter((d) => typeof d === 'string').sort();
  return { parte: { conteudo: { ...novo.conteudo, [bloco]: bl }, fontes, afirmacoes }, desde: datas[0] ?? null };
}

// The two code facts that belong to the Apollo block and go with it (spec 03 v1.18); the other four of
// insumosCodigo are the new run's.
export function insumosDoApollo(anterior: Record<string, unknown> | null | undefined): { apolloEncontrado?: unknown; apolloFuncionarios?: unknown } {
  const a = anterior ?? {};
  return { apolloEncontrado: a.apolloEncontrado, apolloFuncionarios: a.apolloFuncionarios };
}

export interface Preservado<T = string> {
  blocos: string[];
  desde: T;
  falhouEm: T;
  falha: string;
}

// Builds preservado when blocks (or "etapa") are carried. `anterior` is the preservado already on the stage (second
// failure, rule C4): the original `desde` stays, falhouEm is updated; blocks are the union.
export function montaPreservado<T>(blocos: string[], desde: T, falhouEm: T, falha: string, anterior?: Preservado<T> | null): Preservado<T> {
  const uniao = [...new Set([...(anterior?.blocos ?? []), ...blocos])];
  return { blocos: uniao, desde: anterior?.desde ?? desde, falhouEm, falha };
}

// "Usable stage" (spec 03 v1.17, C5): concluida, or falhou with preservado of the whole stage. pendente and
// executando never count, even carrying old content.
export function etapaUsavel(d: { status?: unknown; preservado?: { blocos?: unknown } | null } | null | undefined): boolean {
  if (!d) return false;
  if (d.status === 'concluida') return true;
  return d.status === 'falhou' && Array.isArray(d.preservado?.blocos) && (d.preservado?.blocos as unknown[]).includes('etapa');
}
