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
  // The received value goes into the message (no personal data: a grade word or its type), so the cause
  // of a rejection can be read in the stage document (phase A test, 6/11/2026).
  if (!e.confianca || !GRAUS.includes(e.confianca.grau)) {
    const recebido = e.confianca === undefined ? 'ausente' : typeof e.confianca !== 'object' || e.confianca === null ? `${typeof e.confianca} ${JSON.stringify(e.confianca)}` : `grau ${JSON.stringify(e.confianca.grau)}`;
    return `confianca.grau must be alta, media or baixa (received: ${recebido.slice(0, 60)})`;
  }
  return null;
}

// Value chain of the setor stage (spec 02 v0.33/v0.34, 2.5). The four links are mandatory (a link with no information
// comes as tipo = nao_encontrado, never omitted); `outro` needs nomeDoElo. Returns an error text for the correction
// round, or null. Sources are not checked here: an empty fonteIdx is expected with inferencia or nao_encontrado.
export const ELOS_OBRIGATORIOS = ['fornecedores_insumos', 'producao_operacao', 'distribuicao_canais', 'cliente_final'] as const;
const ELOS_VALIDOS: readonly string[] = [...ELOS_OBRIGATORIOS, 'outro'];
const textoCheio = (v: unknown) => typeof v === 'string' && v.trim() !== '';

export function cadeiaInvalida(conteudo: unknown): string | null {
  const setor = (conteudo as Record<string, any> | null)?.setor;
  const cadeia = setor?.cadeiaDeValor;
  if (!cadeia || typeof cadeia !== 'object' || Array.isArray(cadeia)) return 'setor.cadeiaDeValor must be an object {elos, posicaoDaEmpresa, concentracaoDeMargemOuPoder}';
  if (!Array.isArray(cadeia.elos)) return 'setor.cadeiaDeValor.elos must be a list';
  for (const e of cadeia.elos) {
    if (!e || typeof e !== 'object' || !ELOS_VALIDOS.includes(e.elo)) return `setor.cadeiaDeValor.elos has an elo outside the list (${ELOS_VALIDOS.join(', ')})`;
    if (e.elo === 'outro' && !textoCheio(e.nomeDoElo)) return 'setor.cadeiaDeValor.elos: nomeDoElo is required when elo = outro';
  }
  // tipo (spec 02 v0.37): absent or outside the list is refused; without this an invalid tipo would escape the "elo sem fonte" rule.
  const iTipo = cadeia.elos.findIndex((e: any) => !TIPOS_AFIRMACAO.includes(e.tipo));
  if (iTipo >= 0) return `setor.cadeiaDeValor.elos[${iTipo}].tipo must be fato, inferencia or nao_encontrado`;
  const faltam = ELOS_OBRIGATORIOS.filter((k) => !cadeia.elos.some((e: any) => e.elo === k));
  if (faltam.length) return `setor.cadeiaDeValor.elos without the mandatory elo(s): ${faltam.join(', ')} (use tipo = nao_encontrado when there is no information)`;
  const pos = cadeia.posicaoDaEmpresa;
  if (!pos || typeof pos !== 'object' || !ELOS_VALIDOS.includes(pos.elo)) return 'setor.cadeiaDeValor.posicaoDaEmpresa.elo must be one of the list of elos';
  if (pos.elo === 'outro' && !textoCheio(pos.nomeDoElo)) return 'setor.cadeiaDeValor.posicaoDaEmpresa: nomeDoElo is required when elo = outro';
  if (!TIPOS_AFIRMACAO.includes(pos.tipo)) return 'setor.cadeiaDeValor.posicaoDaEmpresa.tipo must be fato, inferencia or nao_encontrado';
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

  // Re-indexing of the value chain (spec 02 v0.34, section 2): fonteIdx of cadeiaDeValor.elos[] and posicaoDaEmpresa
  // follow the new list, like the statements. An elo `fato` with no source left keeps its type and lowers the
  // stage confidence ("elo sem fonte"). The other content fields with fonteIdx are still not re-indexed (spec pendency).
  const conteudo = reindexaCadeia(bruto.conteudo, mapa, motivos);

  const grau = motivos.length ? 'baixa' : bruto.confianca.grau;
  const motivoModelo = typeof bruto.confianca.motivo === 'string' ? bruto.confianca.motivo.slice(0, 500) : '';
  return {
    conteudo,
    fontes,
    afirmacoes,
    confianca: { grau, motivo: [motivoModelo, ...motivos].filter(Boolean).join('; ') },
    fontesRemovidas,
  };
}

function reindexaElo(e: any, mapa: Map<number, number>): { elo: any; semFonte: boolean } {
  if (!e || typeof e !== 'object') return { elo: e, semFonte: false };
  const idx = Array.isArray(e.fonteIdx) ? [...new Set((e.fonteIdx as unknown[]).filter((n): n is number => Number.isInteger(n) && mapa.has(n as number)).map((n) => mapa.get(n)!))] : [];
  return { elo: { ...e, fonteIdx: idx }, semFonte: e.tipo === 'fato' && !idx.length };
}

// Returns the content with the re-indexed chain (a copy; the model's object is not changed) and adds the reason "elo sem fonte" to `motivos`.
function reindexaCadeia(conteudo: Record<string, any>, mapa: Map<number, number>, motivos: string[]): Record<string, any> {
  const cadeia = conteudo?.setor?.cadeiaDeValor;
  if (!cadeia || typeof cadeia !== 'object' || Array.isArray(cadeia)) return conteudo; // string format (before v0.33) or absent
  let semFonte = false;
  const elos = Array.isArray(cadeia.elos) ? cadeia.elos.map((e: any) => { const r = reindexaElo(e, mapa); semFonte ||= r.semFonte; return r.elo; }) : cadeia.elos;
  let posicao = cadeia.posicaoDaEmpresa;
  if (posicao && typeof posicao === 'object') { const r = reindexaElo(posicao, mapa); semFonte ||= r.semFonte; posicao = r.elo; }
  if (semFonte) motivos.push('elo sem fonte');
  return { ...conteudo, setor: { ...conteudo.setor, cadeiaDeValor: { ...cadeia, elos, posicaoDaEmpresa: posicao } } };
}
