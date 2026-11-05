// Method files (spec 01, config/metodo; spec 02, section 0): fixed order, section filter and
// the publication summary. Pure functions: no Firebase imports, used by the functions, the
// publication script and the tests.
import { createHash } from 'node:crypto';

// Fixed order of the system blocks, so the prompt cache matches (spec 02, section 0).
export const ARQUIVOS_METODO = ['glossario.md', 'escopo-limites.md', 'portas-materiais.md', 'mapa-alavancas.md', 'livro-selecao.md'] as const;
export type ArquivoMetodo = (typeof ARQUIVOS_METODO)[number];

export interface ArquivoPublicado {
  bytes: number;
  sha256: string;
  tokensEstimados: number;
}

// Checks the five names (no more, no less) and returns them in the fixed order with bytes and SHA-256.
export function resumeArquivos(arquivos: { nome: string; conteudo: string }[]): { nome: ArquivoMetodo; conteudo: string; bytes: number; sha256: string }[] {
  const nomes = arquivos.map((a) => a.nome).sort();
  if (nomes.length !== ARQUIVOS_METODO.length || [...ARQUIVOS_METODO].sort().some((n, i) => n !== nomes[i])) {
    throw new Error(`Expected exactly the method files: ${ARQUIVOS_METODO.join(', ')}`);
  }
  return ARQUIVOS_METODO.map((nome) => {
    const conteudo = arquivos.find((a) => a.nome === nome)!.conteudo;
    return { nome, conteudo, bytes: Buffer.byteLength(conteudo, 'utf8'), sha256: createHash('sha256').update(conteudo, 'utf8').digest('hex') };
  });
}

// Short commit hash, as `git log --format=%h` prints it.
export const versaoValida = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{7,12}$/.test(v);

// `git status --porcelain -- metodo` output must be empty before publishing.
export function exigeLimpo(porcelain: string): void {
  if (porcelain.trim()) throw new Error('metodo/ has uncommitted changes; commit them before publishing');
}

// Keeps what comes before the first "## " heading (front matter, title, intro) and the chosen
// sections, identified by number ("## 4. …") or by part letter ("## Parte B – …").
export function filtraSecoes(texto: string, secoes: readonly (number | string)[]): string {
  const partes = texto.split(/^(?=## )/m);
  const id = (bloco: string) => bloco.match(/^## (?:(\d+)\.|Parte ([A-Z])\b)/)?.slice(1).find(Boolean);
  const quer = new Set(secoes.map(String));
  return partes.filter((b, i) => (i === 0 && !b.startsWith('## ')) || quer.has(id(b) ?? '')).join('');
}
