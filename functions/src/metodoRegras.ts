// What the code checks read from the published method (spec 02 v0.12, 4.1): the vetoed terms of
// glossario.md Part C, the names of the adherence grades in escopo-limites.md section 6 and the text of a
// method section cited by a [M:arquivo:seção] mark. Pure functions: no Firebase imports.
import { PROPOSITOS, SECOES_MODELO, TITULOS } from './sintese.js';

export interface TermoVetado { vetado: string; preferido: string }

// Lines "- vetado: "termo" → preferido: "termo" (nota)" of the "Termos vetados" list in Part C; the note is
// not read. Without the list (method before v0.2) the rule has nothing to check.
export function termosVetados(glossario: string): TermoVetado[] {
  const parteC = glossario.split(/^(?=## )/m).find((b) => /^## Parte C\b/.test(b)) ?? '';
  return [...parteC.matchAll(/^-\s*vetado:\s*"([^"]+)"\s*→\s*preferido:\s*"([^"]+)"/gm)].map((m) => ({ vetado: m[1].trim(), preferido: m[2].trim() }));
}

// Grade names from the rows "| A4 · núcleo |" of the adherence scale table.
export function nomesDosGraus(escopoLimites: string): Record<string, string> {
  return Object.fromEntries([...escopoLimites.matchAll(/^\|\s*(A[0-4])\s*·\s*([^|]+?)\s*\|/gm)].map((m) => [m[1], m[2]]));
}

// Text of one section of a method file, identified as in filtraSecoes ("## 1." or "## Parte C"), without the
// part before the first heading; null when the file or the section does not exist.
export function secaoDoMetodo(arquivos: Record<string, string>, arquivo: string, secao: string): string | null {
  const texto = arquivos[arquivo.endsWith('.md') ? arquivo : `${arquivo}.md`];
  if (!texto) return null;
  const alvo = secao.trim().replace(/^parte\s+/i, '').toUpperCase();
  return texto.split(/^(?=## )/m).find((b) => b.match(/^## (?:(\d+)\.|Parte ([A-Z])\b)/)?.slice(1).find(Boolean)?.toUpperCase() === alvo) ?? null;
}

// What the code checks need from the method, read once per verification.
export interface RegrasMetodo {
  vetados: TermoVetado[];
  graus: Record<string, string>;
  arquivos: Record<string, string>;
}

export const regrasDoMetodo = (arquivos: Record<string, string>): RegrasMetodo => ({
  vetados: termosVetados(arquivos['glossario.md'] ?? ''),
  graus: nomesDosGraus(arquivos['escopo-limites.md'] ?? ''),
  arquivos,
});

// Checklist of Part 1 of the reviewer (spec 02 v0.13, 4.2), generated from escopo-limites.md: the six limits of
// section 5 (limite-1 to limite-6), the items of section 4 in order (orienta-1 to orienta-6), the rule on the
// knowledge assistant (section 5) and the rule against reshaping a request (section 7, item 3); and one item per
// section, secao-s1 to secao-s7, with its purpose (spec 02 v0.13, 3.3).
export interface RegraChecklist { regra: string; texto: string }
export function checklistDoRevisor(escopoLimites: string): RegraChecklist[] {
  const secao = (n: number) => escopoLimites.split(/^(?=## )/m).find((b) => b.startsWith(`## ${n}.`)) ?? '';
  const s5 = secao(5);
  const limites = [...s5.matchAll(/^(\d)\.\s+(.+)$/gm)].map((m) => ({ regra: `limite-${m[1]}`, texto: m[2].trim() }));
  const orienta = [...secao(4).matchAll(/^-\s+(.+)$/gm)].map((m, i) => ({ regra: `orienta-${i + 1}`, texto: m[1].trim() }));
  const assistente = s5.split('\n').find((l) => /assistente de conhecimento/i.test(l))?.trim();
  const reformular = secao(7).split('\n').find((l) => /^3\.\s/.test(l))?.replace(/^3\.\s+/, '').trim();
  return [
    ...limites,
    ...orienta,
    ...(assistente ? [{ regra: 'assistente-conhecimento', texto: assistente }] : []),
    ...(reformular ? [{ regra: 'nao-reformular', texto: reformular }] : []),
    ...SECOES_MODELO.map((s) => ({ regra: `secao-${s}`, texto: `o conteúdo de ${s} (${TITULOS[s]}) corresponde ao propósito da seção: ${PROPOSITOS[s]}` })),
  ];
}
