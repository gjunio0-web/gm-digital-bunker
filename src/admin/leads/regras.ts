// Leads list rules (spec 05 §5.1–§5.3; guide v1.2 §5.1 and §7): view model, labels, ordering and filters.
// Pure functions only – no Firestore and no DOM – so the list can be rendered from the mock-up's fictitious
// fichas in the local acceptance test and from Firestore in the hub. Nothing here computes qualification:
// quadrant, grade, points, axes and confidence are read from `lead`, written by the pipeline (graduar).
import { diaSP, diasUteisRestantes } from './diasUteis';

export type Quadrante = 'priorizar' | 'nutrir' | 'qualificar' | 'declinar';
export type Confianca = 'alta' | 'media' | 'baixa';

export interface FichaVM {
  id: string;
  nome: string;
  empresa: string;
  cargo: string;          // label shown in the row
  recebidaEm: Date;
  estado: string;
  erro: { etapa: string; mensagem?: string } | null;
  retencao: { motivo: string } | null;
  respondidaEm: Date | null;
  expurgoEm: Date | null;
  lead: null | {
    momento: 'triagem' | 'analise';
    quadrante: Quadrante;
    grau: 'A' | 'B' | 'C' | 'D';
    pontos: number;
    confianca: Confianca | null;
    spam: boolean;
    eixos: { a: [number, number] | null; d: [number, number] | null; i: [number, number] | null; c: [number, number] | null };
    prazoEm: Date | null;
  };
  /** Copy of enquadramento.escopo and .portaProvavel of the current analysis version, for the two filters. */
  enq: { escopo: string | null; porta: string | null } | null;
}

// ---------- Labels (spec 05 §5.7; site form for the role) ----------
export const ESTADO: Record<string, string> = {
  recebida: 'Recebida', coleta_minima: 'Coleta mínima', qualificada: 'Qualificada', descartada: 'Descartada', resposta_breve: 'Resposta breve',
  coletando: 'Coletando', coletada: 'Coletada', sintetizando: 'Sintetizando', analise_pronta: 'Análise pronta',
  analise_com_pendencias: 'Com pendências', aprovada: 'Aprovada', respondida: 'Respondida', arquivada: 'Arquivada',
};
export const GRUPO: Record<string, string> = {
  recebida: 'entrada', coleta_minima: 'entrada', qualificada: 'entrada', descartada: 'sem', resposta_breve: 'sem',
  coletando: 'analise', coletada: 'analise', sintetizando: 'analise', analise_pronta: 'revisar', analise_com_pendencias: 'revisar',
  aprovada: 'andamento', respondida: 'andamento', arquivada: 'arquivada',
};
const ESTADO_RANK: Record<string, number> = {
  analise_com_pendencias: 1, analise_pronta: 2, aprovada: 3, coletando: 4, coletada: 4, sintetizando: 4, respondida: 5,
  recebida: 6, coleta_minima: 6, qualificada: 6, resposta_breve: 7, descartada: 8, arquivada: 9,
};
export const CARGO: Record<string, string> = {
  owner: 'Sócio(a) ou proprietário(a)', ceo: 'CEO ou presidente', director: 'Diretor(a)', manager: 'Gerente ou coordenador(a)',
  specialist: 'Analista ou especialista', external: 'Consultor(a) externo(a)', other: 'Outro',
};
export const CONF: Record<Confianca, string> = { alta: 'alta', media: 'média', baixa: 'baixa' };
export const QUAD: Record<Quadrante, string> = { priorizar: 'Priorizar', nutrir: 'Nutrir', qualificar: 'Qualificar', declinar: 'Declinar' };
const QRANK: Record<Quadrante, number> = { priorizar: 1, qualificar: 2, nutrir: 3, declinar: 4 };
export const RETENCAO: Record<string, string> = { teto_diario: 'Retida · teto diário', auto_desligada: 'Retida · análise automática desligada' };
const ETAPA_COLETA: Record<string, string> = {
  empresa_digital: 'Presença digital', empresa_registro: 'Registro', empresa_pessoas: 'Pessoas',
  empresa_noticias: 'Notícias', setor: 'Setor', mercado: 'Mercado',
};

/** Error chip text (spec 05 §5.2). */
export function erroTxt(e: { etapa: string }): string {
  const et = e.etapa || '';
  if (et === 'interrupcao:coleta_minima') return 'Erro na coleta mínima · interrompida';
  if (et === 'interrupcao:coletando') return 'Erro na coleta · interrompida';
  if (et === 'interrupcao:coletada') return 'Erro na síntese · não iniciada';
  if (et === 'interrupcao:sintetizando') return 'Erro na síntese · interrompida';
  if (ETAPA_COLETA[et]) return 'Erro na coleta · ' + ETAPA_COLETA[et];
  if (et === 'coletar' || et === 'coleta') return 'Erro na coleta';
  if (et === 'qualificar' || et === 'graduar' || et === 'coletarMinima') return 'Erro na coleta mínima';
  if (et.startsWith('sintetizar') || et.startsWith('sintese')) return 'Erro na síntese';
  if (et.startsWith('verificar') || et.startsWith('verificacao')) return 'Erro na verificação';
  return 'Erro no pipeline';
}

// ---------- Dates (São Paulo) ----------
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** "6/nov" – the mock-up's short date, São Paulo calendar day. */
export function dataCurta(d: Date): string {
  const s = diaSP(d);
  return `${s.getUTCDate()}/${MES[s.getUTCMonth()]}`;
}
/** "2/fev/2027" – the mock-up's date with the year (reception and retention). */
export function dataLonga(d: Date): string {
  return `${dataCurta(d)}/${diaSP(d).getUTCFullYear()}`;
}

// ---------- Row texts ----------
export function prazoTxt(f: FichaVM, hoje: Date): string {
  if (f.estado === 'respondida') return 'respondida';
  if (f.lead?.spam || f.estado === 'descartada') return 'sem resposta';
  if (f.estado === 'arquivada') return 'arquivada';
  if (!f.lead) return 'em análise';
  if (!f.lead.prazoEm) return 'prazo após a análise';
  return `até ${dataCurta(f.lead.prazoEm)} · ${restanteTxt(hoje, f.lead.prazoEm)}`;
}

/**
 * "n d.ú." while the deadline day has not passed; once it has, "vencido" and, from the first business day
 * after it, "vencido há n d.ú." (a deadline on Friday is "vencido" on Saturday, not "0 d.ú.").
 */
export function restanteTxt(hoje: Date, prazo: Date): string {
  if (diaSP(prazo).getTime() >= diaSP(hoje).getTime()) return `${diasUteisRestantes(hoje, prazo)} d.ú.`;
  const n = -diasUteisRestantes(hoje, prazo);
  return n > 0 ? `vencido há ${n} d.ú.` : 'vencido';
}

/** Short retention (spec 04, section 5), the same rule as the pipeline's guardaCurta. */
function guardaCurta(f: FichaVM): boolean {
  const l = f.lead;
  if (!l) return false;
  return l.spam || (l.momento === 'triagem' ? l.quadrante === 'declinar' : l.grau === 'D');
}
export function guardaTxt(f: FichaVM): string {
  if (!f.expurgoEm) return '';
  if (f.estado === 'respondida' && f.respondidaEm) return `respondida em ${dataCurta(f.respondidaEm)} · guarda até ${dataLonga(f.expurgoEm)}`;
  return `guarda até ${dataLonga(f.expurgoEm)}` + (guardaCurta(f) ? ' (30 dias)' : '');
}

export function verificarAntes(f: FichaVM): boolean {
  return !!f.lead && f.lead.confianca === 'baixa' && (f.lead.grau === 'A' || f.lead.grau === 'B');
}

/** Heat step (Design System, Cor de dado): 85+ · 70–84 · 50–69 · 30–49 · below 30. */
export function heat(f: FichaVM): string {
  if (!f.lead) return 'none';
  const p = f.lead.pontos;
  return p >= 85 ? 'h1' : p >= 70 ? 'h2' : p >= 50 ? 'h3' : p >= 30 ? 'h4' : 'h5';
}

export const pct = (e: [number, number]) => Math.round((e[0] / e[1]) * 100);

// ---------- Ordering (spec 05 §5.2; spec 04, 2.6) ----------
export type ChaveOrdem = 'quad' | 'grau' | 'data' | 'estado' | 'ea' | 'ed' | 'ei' | 'ec';
const gradeRank = (f: FichaVM) => (f.lead ? { A: 1, B: 2, C: 3, D: 4 }[f.lead.grau] : 5);
const confRank = (f: FichaVM) => (f.lead && f.lead.confianca ? { alta: 1, media: 2, baixa: 3 }[f.lead.confianca] : 4);

export function cmpGrade(x: FichaVM, y: FichaVM): number {
  const a = gradeRank(x) - gradeRank(y); if (a) return a;
  const b = confRank(x) - confRank(y); if (b) return b;
  const px = x.lead?.prazoEm?.getTime(), py = y.lead?.prazoEm?.getTime();
  if (px != null && py != null) return px - py;
  return px != null ? -1 : py != null ? 1 : 0;
}
export function cmpQuad(x: FichaVM, y: FichaVM): number {
  const nx = x.lead ? 0 : 1, ny = y.lead ? 0 : 1; if (nx !== ny) return nx - ny;   // without lead: last
  const sx = x.lead?.spam ? 1 : 0, sy = y.lead?.spam ? 1 : 0; if (sx !== sy) return sx - sy;  // spam: last
  const a = (x.lead ? QRANK[x.lead.quadrante] : 5) - (y.lead ? QRANK[y.lead.quadrante] : 5); if (a) return a;
  return cmpGrade(x, y);
}
function valor(f: FichaVM, k: ChaveOrdem): number | null {
  if (k === 'data') return f.recebidaEm.getTime();
  if (k === 'estado') return -(ESTADO_RANK[f.estado] ?? 10);
  const m = ({ ea: 'a', ed: 'd', ei: 'i', ec: 'c' } as const)[k as 'ea'];
  if (m) { const e = f.lead?.eixos[m]; return e ? pct(e) : null; }
  return null;
}
export function ordenar(lista: FichaVM[], chave: ChaveOrdem, dir: 'asc' | 'desc'): FichaVM[] {
  return lista.slice().sort((x, y) => {
    if (chave === 'quad') { const q = cmpQuad(x, y); return dir === 'desc' ? q : -q; }
    if (chave === 'grau') {
      const r = cmpGrade(x, y);
      return dir === 'desc' || gradeRank(x) === 5 || gradeRank(y) === 5 ? r : -r;
    }
    const a = valor(x, chave), b = valor(y, chave);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * (dir === 'asc' ? 1 : -1);
  });
}

// ---------- Filters ----------
export interface Filtros { q: string; estado: string; grau: string; conf: string; quad: string; ader: string; esc: string; porta: string }
export function filtrar(lista: FichaVM[], f: Filtros): FichaVM[] {
  const q = f.q.trim().toLowerCase();
  return lista.filter((x) => {
    if (q && `${x.nome} ${x.empresa}`.toLowerCase().indexOf(q) < 0) return false;
    if (f.estado === 'erro' ? !x.erro : f.estado && GRUPO[x.estado] !== f.estado) return false;
    if (f.grau && x.lead?.grau !== f.grau) return false;
    if (f.conf && x.lead?.confianca !== f.conf) return false;
    if (f.quad && x.lead?.quadrante !== f.quad) return false;
    if (f.ader) { const a = x.lead?.eixos.a; if (!a) return false; if ((a[0] >= 15 ? 'alta' : 'baixa') !== f.ader) return false; }
    if (f.esc && x.enq?.escopo !== f.esc) return false;
    if (f.porta && x.enq?.porta !== f.porta) return false;
    return true;
  });
}
