// Value chain of the setor stage by activities (spec 02 v0.38 to v0.42, sections 2, 2.5, 3.3 and 4.1): limits read
// from config/pipeline, the 14 refusal groups of the code validation, re-indexing of sources, the single chain order,
// the format of coleta/setor and the informative warning elo_sem_atores_e_objetos. Pure functions (no Firebase).

export const ELOS_FIXOS = ['suprimento', 'producao_operacao', 'distribuicao_comercializacao', 'servico_relacionamento'] as const;
const ELOS_VALIDOS: readonly string[] = [...ELOS_FIXOS, 'outro'];
const TIPOS = ['fato', 'inferencia', 'nao_encontrado'];
const TIPOS_APOIO = ['fato', 'inferencia']; // v0.41: nao_encontrado is not admitted in support activities

// Structural limits (spec 01 v0.46 to v0.48, config/pipeline). A missing or invalid value falls back to the default.
export interface LimitesCadeia {
  tetoCaracteresItemCadeia: number;
  maxItensListaCadeia: number;
  maxElosCadeia: number;
  maxAtividadesApoio: number;
  tetoCaracteresNomeElo: number;
}
export const LIMITES_CADEIA_PADRAO: LimitesCadeia = {
  tetoCaracteresItemCadeia: 40,
  maxItensListaCadeia: 5,
  maxElosCadeia: 6,
  maxAtividadesApoio: 2,
  tetoCaracteresNomeElo: 24,
};
export function limitesCadeia(p: Partial<Record<keyof LimitesCadeia, unknown>> | null | undefined): LimitesCadeia {
  const r = { ...LIMITES_CADEIA_PADRAO };
  for (const k of Object.keys(r) as (keyof LimitesCadeia)[]) {
    const v = p?.[k];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) r[k] = v;
  }
  return r;
}

// The setor clause carries markers ⟨name⟩ for these parameters; the code replaces them before the call (v0.39).
export function comLimites(texto: string, l: LimitesCadeia): string {
  return texto.replace(/⟨(\w+)⟩/g, (m, nome: string) => (nome in l ? String(l[nome as keyof LimitesCadeia]) : m));
}

const textoCheio = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const tamanho = (s: string) => Array.from(s).length; // characters, not UTF-16 units
// A link is identified by the pair {elo, nomeDoElo}; nomeDoElo is compared without case and outer spaces.
const chave = (elo: unknown, nome: unknown) => `${String(elo)}|${typeof nome === 'string' ? nome.trim().toLowerCase() : ''}`;
const ehObjeto = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

function listaInvalida(v: unknown, onde: string, l: LimitesCadeia): string | null {
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) return `${onde} must be a list of strings`;
  if (v.length > l.maxItensListaCadeia) return `${onde} has ${v.length} items; the maximum is ${l.maxItensListaCadeia}`;
  const longo = (v as string[]).find((s) => tamanho(s) > l.tetoCaracteresItemCadeia);
  if (longo !== undefined) return `${onde} has an item longer than ${l.tetoCaracteresItemCadeia} characters ("${longo.slice(0, 60)}")`;
  return null;
}

// Validation of the model's setor output (spec 02, 2.5, groups 1 to 14). Returns an error text for the correction
// round, or null. Group numbers in the comments follow the spec.
export function cadeiaInvalida(conteudo: unknown, l: LimitesCadeia = LIMITES_CADEIA_PADRAO): string | null {
  const cadeia = (conteudo as Record<string, any> | null)?.setor?.cadeiaDeValor;
  // (1)
  if (!ehObjeto(cadeia)) return 'setor.cadeiaDeValor must be an object {elos, atividadesDeApoio, clienteFinal, posicaoDaEmpresa, concentracaoDeMargemOuPoder}';
  if (!Array.isArray(cadeia.elos)) return 'setor.cadeiaDeValor.elos must be a list';
  if (!Array.isArray(cadeia.atividadesDeApoio)) return 'setor.cadeiaDeValor.atividadesDeApoio must be a list (an empty list is valid)';
  const elos = cadeia.elos as any[];
  // (3) and (12)
  for (const [i, e] of elos.entries()) {
    if (!ehObjeto(e) || !ELOS_VALIDOS.includes(e.elo)) return `setor.cadeiaDeValor.elos[${i}].elo must be one of ${ELOS_VALIDOS.join(', ')}`;
    if (e.elo === 'outro') {
      if (!textoCheio(e.nomeDoElo)) return `setor.cadeiaDeValor.elos[${i}]: nomeDoElo is required when elo = outro`;
      if (tamanho(e.nomeDoElo.trim()) > l.tetoCaracteresNomeElo) return `setor.cadeiaDeValor.elos[${i}].nomeDoElo is longer than ${l.tetoCaracteresNomeElo} characters`;
    } else if (textoCheio(e.nomeDoElo)) return `setor.cadeiaDeValor.elos[${i}]: nomeDoElo must be null in the fixed elo ${e.elo}`;
  }
  // (2)
  const faltam = ELOS_FIXOS.filter((k) => !elos.some((e) => e.elo === k));
  if (faltam.length) return `setor.cadeiaDeValor.elos without the mandatory elo(s): ${faltam.join(', ')} (use tipo = nao_encontrado when there is no information)`;
  // (4)
  const pares = elos.map((e) => chave(e.elo, e.nomeDoElo));
  const repetido = pares.find((k, i) => pares.indexOf(k) !== i);
  if (repetido) return `setor.cadeiaDeValor.elos repeats the pair {elo, nomeDoElo} ${repetido.replace('|', ', ')}`;
  // (10)
  if (elos.length > l.maxElosCadeia) return `setor.cadeiaDeValor.elos has ${elos.length} elos; the maximum is ${l.maxElosCadeia}`;
  // (14)
  for (const [i, e] of elos.entries()) {
    const d = e.depoisDe;
    if (e.elo === 'outro') {
      if (d !== undefined && d !== null && !(ELOS_FIXOS as readonly string[]).includes(d)) return `setor.cadeiaDeValor.elos[${i}].depoisDe must be null or one of ${ELOS_FIXOS.join(', ')}`;
    } else if (d !== undefined && d !== null) return `setor.cadeiaDeValor.elos[${i}].depoisDe must be null in the fixed elo ${e.elo}`;
  }
  // (5)
  if (!ehObjeto(cadeia.clienteFinal)) return 'setor.cadeiaDeValor.clienteFinal is missing (use tipo = nao_encontrado when there is no information)';
  // (6)
  const pos = cadeia.posicaoDaEmpresa;
  if (!ehObjeto(pos) || !Array.isArray(pos.elos) || !pos.elos.length) return 'setor.cadeiaDeValor.posicaoDaEmpresa.elos must list one or more elos of elos[]';
  const paresPos = (pos.elos as any[]).map((e) => (ehObjeto(e) ? chave(e.elo, e.nomeDoElo) : '?'));
  if (paresPos.some((k, i) => paresPos.indexOf(k) !== i)) return 'setor.cadeiaDeValor.posicaoDaEmpresa.elos repeats an elo';
  for (const [i, e] of (pos.elos as any[]).entries()) {
    if (!ehObjeto(e) || !pares.includes(chave(e.elo, e.nomeDoElo))) return `setor.cadeiaDeValor.posicaoDaEmpresa.elos[${i}] is not an elo of elos[] (same elo and nomeDoElo)`;
    if (!textoCheio(e.papel)) return `setor.cadeiaDeValor.posicaoDaEmpresa.elos[${i}].papel is required`;
  }
  // (7) and (13)
  const conc = cadeia.concentracaoDeMargemOuPoder;
  if (conc !== null && conc !== undefined) {
    if (!ehObjeto(conc) || !pares.includes(chave(conc.elo, conc.nomeDoElo))) return 'setor.cadeiaDeValor.concentracaoDeMargemOuPoder must be null or point to an elo of elos[] (same elo and nomeDoElo)';
    if (!Array.isArray(conc.fonteIdx) || !conc.fonteIdx.length) return 'setor.cadeiaDeValor.concentracaoDeMargemOuPoder needs a source (fonteIdx); without a source it must be null';
  }
  // (8)
  const iTipo = elos.findIndex((e) => !TIPOS.includes(e.tipo));
  if (iTipo >= 0) return `setor.cadeiaDeValor.elos[${iTipo}].tipo must be fato, inferencia or nao_encontrado`;
  if (!TIPOS.includes(cadeia.clienteFinal.tipo)) return 'setor.cadeiaDeValor.clienteFinal.tipo must be fato, inferencia or nao_encontrado';
  if (!TIPOS.includes(pos.tipo)) return 'setor.cadeiaDeValor.posicaoDaEmpresa.tipo must be fato, inferencia or nao_encontrado';
  const apoio = cadeia.atividadesDeApoio as any[];
  const iApoio = apoio.findIndex((a) => !ehObjeto(a) || !TIPOS_APOIO.includes(a.tipo));
  if (iApoio >= 0) return `setor.cadeiaDeValor.atividadesDeApoio[${iApoio}].tipo must be fato or inferencia (nao_encontrado is not admitted: leave the list empty when there is no information)`;
  // (9)
  for (const [i, e] of elos.entries()) {
    const erro = listaInvalida(e.atores, `setor.cadeiaDeValor.elos[${i}].atores`, l) ?? listaInvalida(e.objetos, `setor.cadeiaDeValor.elos[${i}].objetos`, l);
    if (erro) return erro;
  }
  for (const [i, a] of apoio.entries()) {
    const erro = listaInvalida(a.atores, `setor.cadeiaDeValor.atividadesDeApoio[${i}].atores`, l);
    if (erro) return erro;
  }
  // (11)
  if (apoio.length > l.maxAtividadesApoio) return `setor.cadeiaDeValor.atividadesDeApoio has ${apoio.length} items; the maximum is ${l.maxAtividadesApoio}`;
  return null;
}

// Re-indexing (spec 02, section 2): after unverified sources are removed, fonteIdx of elos[], atividadesDeApoio[],
// clienteFinal, posicaoDaEmpresa and concentracaoDeMargemOuPoder follow the new list. A `fato` item left without
// sources keeps its type and lowers the stage confidence ("elo sem fonte"); a concentration left without sources
// goes back to null (v0.39). Returns a copy; the model's object is not changed.
function reindexa(item: any, mapa: Map<number, number>): { item: any; semFonte: boolean } {
  if (!ehObjeto(item)) return { item, semFonte: false };
  const idx = Array.isArray(item.fonteIdx)
    ? [...new Set((item.fonteIdx as unknown[]).filter((n): n is number => Number.isInteger(n) && mapa.has(n as number)).map((n) => mapa.get(n)!))]
    : [];
  return { item: { ...item, fonteIdx: idx }, semFonte: item.tipo === 'fato' && !idx.length };
}
export function reindexaCadeia(conteudo: Record<string, any>, mapa: Map<number, number>, motivos: string[]): Record<string, any> {
  const cadeia = conteudo?.setor?.cadeiaDeValor;
  if (!ehObjeto(cadeia)) return conteudo; // text format (before v0.33) or absent
  let semFonte = false;
  const um = (v: any) => { const r = reindexa(v, mapa); semFonte ||= r.semFonte; return r.item; };
  const nova: Record<string, any> = { ...cadeia };
  if (Array.isArray(cadeia.elos)) nova.elos = cadeia.elos.map(um);
  if (Array.isArray(cadeia.atividadesDeApoio)) nova.atividadesDeApoio = cadeia.atividadesDeApoio.map(um);
  if (ehObjeto(cadeia.clienteFinal)) nova.clienteFinal = um(cadeia.clienteFinal);
  if (ehObjeto(cadeia.posicaoDaEmpresa)) nova.posicaoDaEmpresa = um(cadeia.posicaoDaEmpresa);
  if (ehObjeto(cadeia.concentracaoDeMargemOuPoder)) {
    const c = reindexa(cadeia.concentracaoDeMargemOuPoder, mapa).item;
    nova.concentracaoDeMargemOuPoder = c.fonteIdx.length ? c : null;
  }
  if (semFonte) motivos.push('elo sem fonte');
  return { ...conteudo, setor: { ...conteudo.setor, cadeiaDeValor: nova } };
}

// Format of coleta/setor (spec 02, 3.3): (a) text chain, or setor null or absent; (b) object without clienteFinal
// (v0.33 to v0.37); (c) object with clienteFinal (v0.38 onwards).
export type FormatoCadeia = 'texto' | 'objeto' | 'atividades';
export function formatoDoConteudo(conteudo: unknown): FormatoCadeia {
  const c = (conteudo as { setor?: { cadeiaDeValor?: unknown } } | null)?.setor?.cadeiaDeValor;
  if (!ehObjeto(c)) return 'texto';
  return 'clienteFinal' in c ? 'atividades' : 'objeto';
}

// The single chain order (spec 02, 2.5, v0.40): fixed elos in canonical order wherever they are in the array; each
// `outro` right after the fixed elo named in depoisDe; with depoisDe null, absent or not a fixed elo, at the end.
// Several `outro` with the same depoisDe keep their array order.
export function ordemDaCadeia<T extends { elo?: unknown; depoisDe?: unknown }>(elos: readonly T[]): T[] {
  const fixos = ELOS_FIXOS as readonly unknown[];
  const outros = elos.filter((e) => !fixos.includes(e.elo));
  const ancora = (e: T) => (fixos.includes(e.depoisDe) ? e.depoisDe : null);
  const r: T[] = [];
  for (const f of ELOS_FIXOS) {
    r.push(...elos.filter((e) => e.elo === f), ...outros.filter((e) => ancora(e) === f));
  }
  r.push(...outros.filter((e) => ancora(e) === null));
  return r;
}

// Content with the chain already in chain order, for format (c) only; other formats are returned as they are.
export function comCadeiaOrdenada<C>(conteudo: C): C {
  if (formatoDoConteudo(conteudo) !== 'atividades') return conteudo;
  const c = conteudo as any;
  const cadeia = c.setor.cadeiaDeValor;
  if (!Array.isArray(cadeia.elos)) return conteudo;
  return { ...c, setor: { ...c.setor, cadeiaDeValor: { ...cadeia, elos: ordemDaCadeia(cadeia.elos) } } };
}

// Informative warning (spec 02, 4.1, v0.39): each elo fato or inferencia of a format (c) chain with atores and objetos
// both empty gives "elo_sem_atores_e_objetos: <elo>", or "outro (<nomeDoElo>)" for the elo outro, in chain order.
// An elo nao_encontrado does not count.
export function avisosDaCadeia(conteudo: unknown): string[] {
  if (formatoDoConteudo(conteudo) !== 'atividades') return [];
  const elos = (conteudo as any).setor.cadeiaDeValor.elos;
  if (!Array.isArray(elos)) return [];
  const vazio = (v: unknown) => !Array.isArray(v) || !v.length;
  return ordemDaCadeia(elos as any[])
    .filter((e) => ehObjeto(e) && (e.tipo === 'fato' || e.tipo === 'inferencia') && vazio(e.atores) && vazio(e.objetos))
    .map((e) => `elo_sem_atores_e_objetos: ${e.elo === 'outro' ? `outro (${String(e.nomeDoElo ?? '').trim()})` : e.elo}`);
}
