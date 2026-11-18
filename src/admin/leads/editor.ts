// Editar análise (spec 05 §5.7; spec 01 §4.1 item 5). Pure rules – sections, limit, counter text, labels – so the bar
// and the tests take them from one place. The function (acaoAdmin) stays the authority on every one of them.
import { SECAO } from './rotulos';

type Obj = Record<string, any>;

/** Sections the editor offers: s1 to s7. s0 and s8 are built by code; title, summary and draft are not editable here. */
export const SECOES_EDITAVEIS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;
export const LIMITE_EDITOR = 20_000;

/** Note shown only in the s6 editor (spec 05 §5.7, mock-up wording). */
export const NOTA_S6 = 'Editar o texto de s6 não altera os filtros de escopo e de porta provável nem a qualificação; a porta do administrador fica em "Decidir porta".';

/** "s6 · Enquadramento": the label of an option of the section selector. */
export const rotuloSecao = (k: string): string => (SECAO[k] ?? k).replace(/^(s\d) /, '$1 · ');

export type ForaDoLimite = 'vazio' | 'acima' | null;
export interface Validacao { n: number; fora: ForaDoLimite; ok: boolean }

/** Empty or over the limit blocks the button. Whitespace-only text counts as empty. Length is counted as typed (UTF-16 units). */
export function validaCorpo(texto: string): Validacao {
  const n = texto.length;
  const fora: ForaDoLimite = texto.trim().length === 0 ? 'vazio' : n > LIMITE_EDITOR ? 'acima' : null;
  return { n, fora, ok: fora === null };
}

/** "n de 20.000 caracteres", plus the reason when the button is blocked. */
export function contagemTxt(v: Validacao): string {
  return `${v.n.toLocaleString('pt-BR')} de ${LIMITE_EDITOR.toLocaleString('pt-BR')} caracteres` +
    (v.fora === 'vazio' ? ' · o texto não pode ficar vazio' : v.fora === 'acima' ? ' · acima do limite' : '');
}

/** Number of the version the save would write: the highest existing number plus one. */
export const proximaVersao = (analises: { num: number }[]): number => analises.reduce((m, a) => Math.max(m, a.num), 0) + 1;

/** Current text of a section in a version (empty when the section is empty or missing). */
export const corpoDaSecao = (d: Obj, secao: string): string => {
  const c = d?.secoes?.[secao]?.corpo;
  return typeof c === 'string' ? c : '';
};
