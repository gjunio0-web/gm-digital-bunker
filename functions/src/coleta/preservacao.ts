// Preservation of the previous data on a re-run (spec 03, section 7.3; spec 01, coleta/{etapa}.preservado).
// Pure functions only (no Firestore, no provider call): the failure and merge tests are unit tests because
// pode() is false in the emulator. The engine (motor.ts) applies them.
import type { Timestamp } from 'firebase-admin/firestore';
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
export function etapaUsavel<T extends { status?: unknown; preservado?: { blocos?: unknown } | null }>(d: T | null | undefined): d is T {
  if (!d) return false;
  if (d.status === 'concluida') return true;
  return d.status === 'falhou' && Array.isArray(d.preservado?.blocos) && (d.preservado?.blocos as unknown[]).includes('etapa');
}

// Every stage of a set is usable for what comes next (the triagem, or the synthesis): concluida, nao_aplicavel, or
// falhou with the whole stage preserved. A missing document ({}), pendente or executando makes it false.
export function etapasUsaveis(etapas: { status?: unknown; preservado?: { blocos?: unknown } | null }[]): boolean {
  return etapas.every((d) => ['concluida', 'nao_aplicavel'].includes(d.status as string) || etapaUsavel(d));
}

// What the engine tried for a block in this run. "nao_consultado": provider off, no key or cap reached.
export interface Tentativa {
  resultado: Resultado | 'nao_consultado';
  // Reason as recorded in preservado.falha (e.g. "resposta HTTP 503", "desligado na configuração").
  motivo: string;
  // Instagram only: the profile consulted (or that would have been) now; null when none was determined.
  perfil?: string | null;
}

export interface ParteAnterior extends Parte {
  insumosCodigo?: Record<string, unknown> | null;
}

export interface ResultadoPreservacao {
  parte: Parte;
  blocos: Bloco[];
  falha: string;
  // Earliest original consultation among the carried sources (ISO), null when none is known.
  desde: string | null;
  // Present when the Apollo block was carried: the two code facts that go with it.
  insumosApollo?: { apolloEncontrado?: unknown; apolloFuncionarios?: unknown };
}

const ROTULO: Record<Bloco, string> = { apollo: 'Apollo', instagram: 'Instagram' };

// Decides and applies the block-level preservation of empresa_digital (spec 03 7.3): a block is carried when its
// provider failed or was not consulted, the previous run had data for it and, for Instagram, the previous profile
// is the one consulted now. Returns null when nothing is carried.
export function preservaBlocos(novo: Parte, anterior: ParteAnterior | null | undefined, t: { apollo?: Tentativa; instagram?: Tentativa }): ResultadoPreservacao | null {
  if (!anterior) return null;
  let parte = novo;
  const blocos: Bloco[] = [];
  const falhas: string[] = [];
  const datas: string[] = [];
  let insumosApollo: ResultadoPreservacao['insumosApollo'];
  const carrega = (bloco: Bloco, tent: Tentativa) => {
    const f = fundeBloco(parte, anterior, bloco);
    if (!f) return;
    parte = f.parte;
    blocos.push(bloco);
    falhas.push(`${ROTULO[bloco]}: ${tent.motivo}`);
    if (f.desde) datas.push(f.desde);
  };
  const ta = t.apollo;
  if (apolloSeraPreservado(anterior, ta) && ta) {
    carrega('apollo', ta);
    if (blocos.includes('apollo')) insumosApollo = insumosDoApollo(anterior.insumosCodigo);
  }
  const ti = t.instagram;
  const ig = anterior.conteudo?.instagram as Record<string, unknown> | undefined;
  if (ti && ti.resultado !== 'encontrado' && ti.resultado !== 'nao_encontrado' && instagramTemDados(ig) && mesmoPerfil(ig?.perfil, ti.perfil)) carrega('instagram', ti);
  if (!blocos.length) return null;
  return { parte, blocos, falha: falhas.join('; '), desde: datas.sort()[0] ?? null, insumosApollo };
}

// What a re-run keeps of the previous run of a stage (read by coletar before the claim).
export interface DocAnterior {
  status: string;
  conteudo: Record<string, unknown>;
  fontes: FonteColeta[];
  afirmacoes: Afirmacao[];
  confianca: { grau: 'alta' | 'media' | 'baixa'; motivo: string };
  insumosCodigo?: Record<string, unknown> | null;
  paginasLidas?: string[];
  concluidoEm?: Timestamp;
  preservado?: Preservado<Timestamp> | null;
}

// Previous usable data of a stage document, or null. Once the admin action sets a stage "pendente" its former status is
// gone, so usability is read from the content: a stage that failed without preservation was written with an empty
// `conteudo`, and a stage never run has none; any other document with content (concluida, falhou with the whole stage
// preserved, or left pendente/executando by a claim that no longer erases) carries usable previous data.
export function anteriorDe(d: Record<string, unknown> | null | undefined): DocAnterior | null {
  if (!d || !d.conteudo || typeof d.conteudo !== 'object' || Array.isArray(d.conteudo) || !Object.keys(d.conteudo).length) return null;
  if (d.status === 'falhou' && !etapaUsavel(d as { status: unknown; preservado?: { blocos?: unknown } | null })) return null;
  return {
    status: String(d.status ?? ''),
    conteudo: d.conteudo as Record<string, unknown>,
    fontes: (d.fontes as DocAnterior['fontes']) ?? [],
    afirmacoes: (d.afirmacoes as DocAnterior['afirmacoes']) ?? [],
    confianca: (d.confianca as DocAnterior['confianca']) ?? { grau: 'baixa', motivo: 'sem confiança gravada' },
    insumosCodigo: (d.insumosCodigo as Record<string, unknown> | null | undefined) ?? null,
    paginasLidas: d.paginasLidas as string[] | undefined,
    concluidoEm: d.concluidoEm as Timestamp | undefined,
    preservado: (d.preservado as Preservado<Timestamp> | null | undefined) ?? null,
  };
}

// Fixed input given to the model of empresa_digital in place of the Apollo result when the Apollo block of the previous
// run will be kept (spec 02 v0.32): the code already knows this before the model call, because the Apollo query comes first.
export const INSUMO_APOLLO_MANTIDO =
  'O Apollo não pôde ser consultado nesta execução; o código mantém o dado da execução anterior; não escreva afirmação sobre o Apollo.';

// True when the Apollo block of `anterior` will be carried: the query failed or was not made, and the previous run had data.
export function apolloSeraPreservado(anterior: Pick<Parte, 'conteudo'> | null | undefined, t: Tentativa | undefined): boolean {
  return Boolean(t) && t?.resultado !== 'encontrado' && t?.resultado !== 'nao_encontrado' && apolloTemDados(anterior?.conteudo?.apollo);
}

// Short reason without personal data for preservado.falha (spec 01): e-mails and long digit runs (CPF, CNPJ, phone) are
// masked, line breaks collapsed, and the text cut at 200 characters.
export function saneiaMotivo(m: unknown): string {
  return String(m ?? '')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[e-mail]')
    .replace(/\(?\d[\d.\-/() ]{6,}\d/g, '[número]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
