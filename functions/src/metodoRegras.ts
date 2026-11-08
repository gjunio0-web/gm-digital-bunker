// What the code checks read from the published method (spec 02 v0.12, 4.1): the vetoed terms of
// glossario.md Part C, the names of the adherence grades in escopo-limites.md section 6 and the text of a
// method section cited by a [M:arquivo:seção] mark. Pure functions: no Firebase imports.

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
