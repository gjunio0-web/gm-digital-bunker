// Collection envelope (spec 02, section 2): shape check, source verification and the filling rule.
// Sources must have been really consulted (code-provided sources, or URLs returned by web search /
// web fetch in the same call); unverified sources are removed and lower the confidence. A field
// with value needs a sourced statement; since statements do not name their field, the code checks
// that sourced statements exist whenever the content has values ("campos sem fonte" otherwise).
import { chaveUrl } from './claudeColeta.js';

export interface FonteColeta {
  url: string;
  titulo: string;
  tipo: 'busca' | 'pagina' | 'api' | 'inferencia';
  consultadoEm: string;
}
export interface Afirmacao {
  texto: string;
  tipo: 'fato' | 'inferencia' | 'nao_encontrado';
  fonteIdx: number[];
}
export interface Envelope {
  conteudo: Record<string, unknown>;
  fontes: FonteColeta[];
  afirmacoes: Afirmacao[];
  confianca: { grau: 'alta' | 'media' | 'baixa'; motivo: string };
  // Sources the model cited that the code could not verify (kept for diagnosis, same retention as the ficha).
  fontesRemovidas: { url: string; titulo: string; tipo: string }[];
}

const GRAUS = ['alta', 'media', 'baixa'];
const TIPOS_AFIRMACAO = ['fato', 'inferencia', 'nao_encontrado'];

// Returns an error text, or null when the answer has the envelope and the stage's content keys.
export function formatoInvalido(v: unknown, chaves: readonly string[]): string | null {
  const e = v as Record<string, any>;
  if (!e || typeof e !== 'object') return 'answer is not an object';
  if (!e.conteudo || typeof e.conteudo !== 'object' || Array.isArray(e.conteudo)) return 'conteudo missing';
  const faltam = chaves.filter((k) => !(k in e.conteudo));
  if (faltam.length) return `conteudo without: ${faltam.join(', ')}`;
  if (!Array.isArray(e.fontes) || e.fontes.some((f: any) => !f || typeof f.url !== 'string')) return 'fontes must be a list of {url, titulo, tipo, consultadoEm}';
  if (!Array.isArray(e.afirmacoes) || e.afirmacoes.some((a: any) => !a || typeof a.texto !== 'string' || !TIPOS_AFIRMACAO.includes(a.tipo) || !Array.isArray(a.fonteIdx))) {
    return 'afirmacoes must be a list of {texto, tipo (fato|inferencia|nao_encontrado), fonteIdx[]}';
  }
  if (!e.confianca || !GRAUS.includes(e.confianca.grau)) return 'confianca.grau must be alta, media or baixa';
  return null;
}

const temValor = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== '' && v !== 'nao_coletada' && !(Array.isArray(v) && !v.length) &&
  !(typeof v === 'object' && !Array.isArray(v) && !Object.values(v as object).some(temValor));

// Normalizes the envelope: keeps verified sources only (re-indexing statements), drops invalid
// indices, and lowers confidence with the reasons found.
export function normalizaEnvelope(bruto: Record<string, any>, verificadas: Set<string>, agoraIso: string): Envelope {
  const motivos: string[] = [];
  const mapa = new Map<number, number>();
  const fontes: FonteColeta[] = [];
  const fontesRemovidas: Envelope['fontesRemovidas'] = [];
  (bruto.fontes as any[]).forEach((f, i) => {
    if (!verificadas.has(chaveUrl(f.url))) {
      fontesRemovidas.push({ url: f.url.slice(0, 500), titulo: typeof f.titulo === 'string' ? f.titulo.slice(0, 200) : '', tipo: String(f.tipo ?? '').slice(0, 20) });
      return;
    }
    mapa.set(i, fontes.length);
    fontes.push({
      url: f.url,
      titulo: typeof f.titulo === 'string' ? f.titulo.slice(0, 200) : '',
      tipo: ['busca', 'pagina', 'api', 'inferencia'].includes(f.tipo) ? f.tipo : 'busca',
      consultadoEm: typeof f.consultadoEm === 'string' && f.consultadoEm ? f.consultadoEm : agoraIso,
    });
  });
  if (fontesRemovidas.length) motivos.push(`${fontesRemovidas.length} fonte(s) não verificada(s) removida(s)`);

  let semFonte = 0;
  const afirmacoes: Afirmacao[] = (bruto.afirmacoes as any[]).map((a) => {
    const idx = (a.fonteIdx as unknown[]).filter((n): n is number => Number.isInteger(n) && mapa.has(n as number)).map((n) => mapa.get(n)!);
    if (a.tipo !== 'nao_encontrado' && !idx.length) semFonte++;
    return { texto: String(a.texto).slice(0, 1000), tipo: a.tipo, fonteIdx: [...new Set(idx)] };
  });
  if (semFonte) motivos.push(`${semFonte} afirmação(ões) sem fonte`);
  const comFonte = afirmacoes.some((a) => a.fonteIdx.length);
  if (Object.values(bruto.conteudo).some(temValor) && !comFonte) motivos.push('campos sem fonte');

  const grau = motivos.length ? 'baixa' : bruto.confianca.grau;
  const motivoModelo = typeof bruto.confianca.motivo === 'string' ? bruto.confianca.motivo.slice(0, 500) : '';
  return {
    conteudo: bruto.conteudo,
    fontes,
    afirmacoes,
    confianca: { grau, motivo: [motivoModelo, ...motivos].filter(Boolean).join('; ') },
    fontesRemovidas,
  };
}
