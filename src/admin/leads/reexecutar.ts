// Reexecutar targets by state (spec 05 §5.7; spec 01 v0.40 to v0.45, §4.1 item 3). Pure function – ficha state, erro and
// collection stages in, the options of the selector out – so the action bar (phase 5) takes the rule from here and nowhere
// else. The function (acaoAdmin) stays the authority and refuses whatever the hub offers in excess.
import { ETAPA_COLETA } from './rotulos';

type Obj = Record<string, any>;

export const ETAPAS_MINIMAS = ['empresa_digital', 'empresa_registro'] as const;
export const ETAPAS_COLETA = ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado'] as const;

/**
 * A stage whose content can be used: `concluida`, or `falhou` with the whole stage preserved (`preservado.blocos` has
 * "etapa"). `pendente`, `executando`, a missing document and any other status are not usable; `nao_aplicavel` is not a
 * stage status (spec 01 v0.45) and does not count.
 */
export function etapaUsavel(e: Obj | undefined | null): boolean {
  if (!e) return false;
  if (e.status === 'concluida') return true;
  return e.status === 'falhou' && Array.isArray(e.preservado?.blocos) && e.preservado.blocos.includes('etapa');
}

export interface OpcaoReexecutar {
  /** Value sent in `alvo` to acaoAdmin. */
  alvo: string;
  rotulo: string;
  /** Short description; only the ones approved by Gon are filled (spec 05 §5.7), the rest stay empty until phase 5. */
  descricao: string;
  /** Pendente stage: it runs anyway, so it is shown checked and locked ("roda junto: nunca terminou", spec 05 §5.7). */
  rodaJunto: boolean;
  /** Valid only alone (Síntese, Qualificação, Coleta mínima): choosing it clears the others. */
  exclusiva: boolean;
}

const ESTADOS_ANALISADOS = ['analise_pronta', 'analise_com_pendencias', 'aprovada'];

/** Short descriptions of the options, approved by Gon on 17/nov/2026 (spec 05 §5.7, v1.48). */
export const DESCRICAO: Record<string, string> = {
  coleta_minima: 'Recomeça a coleta mínima desde o início.',
  sintese: 'Gera a análise de novo a partir da coleta, como nova versão.',
  qualificacao: 'Refaz a qualificação e a triagem, sem refazer a coleta.',
  empresa_digital: 'Refaz a leitura do site e dos perfis públicos da empresa.',
  empresa_registro: 'Refaz a consulta ao registro da empresa na Receita Federal.',
  empresa_pessoas: 'Refaz a busca do cargo do signatário e de outros decisores visíveis.',
  empresa_noticias: 'Refaz a busca de notícias recentes sobre a empresa.',
  setor: 'Refaz a leitura do setor da empresa.',
  mercado: 'Refaz a leitura do mercado da empresa.',
};
/** Note under the selector, always visible, in `muted` (spec 05 §5.7, v1.48). */
export const NOTA_REEXECUTAR = 'Coleta: busca automática de informações sobre a empresa e o contato, em etapas. Coleta mínima: só o site e o registro da empresa. Síntese: a análise escrita a partir da coleta.';
export const TEXTO_VAZIO_REEXECUTAR = 'Escolha as etapas';

const exclusiva = (alvo: string, rotulo: string): OpcaoReexecutar => ({ alvo, rotulo, descricao: DESCRICAO[alvo] ?? '', rodaJunto: false, exclusiva: true });
const etapa = (alvo: string, rodaJunto = false): OpcaoReexecutar => ({ alvo, rotulo: ETAPA_COLETA[alvo] ?? alvo, descricao: DESCRICAO[alvo] ?? '', rodaJunto, exclusiva: false });

/** Stages of the phase that the function accepts as targets in a long state: falhou, pendente or executando. */
function etapasNaoConcluidas(fase: readonly string[], coleta: Record<string, Obj>): OpcaoReexecutar[] {
  return fase
    .filter((k) => ['falhou', 'pendente', 'executando'].includes(coleta[k]?.status))
    .map((k) => etapa(k, coleta[k].status === 'pendente'));
}

/**
 * Options of the Reexecutar selector for a ficha, in the order of the spec. Empty list: Reexecutar is not offered.
 * - Análise pronta, Com pendências, Aprovada: Síntese and the six stages that have a document (erro not required).
 * - Recebida with erro: Coleta mínima, alone.
 * - Coleta mínima with erro: the minimal stages that are falhou, pendente or executando, or Qualificação when both
 *   minimal stages are usable, with any erro.etapa.
 * - Coletando with erro: the stages that are falhou, pendente or executando, or Síntese when all six are usable.
 * - Coletada and Sintetizando with erro: Síntese only.
 * - Qualificada with erro.etapa graduar: Qualificação only.
 * - Any other state, no erro in a long state, and Arquivada: nothing.
 */
export function alvosReexecutar(estado: string, erro: { etapa?: string } | null | undefined, coleta: Record<string, Obj> = {}): OpcaoReexecutar[] {
  if (ESTADOS_ANALISADOS.includes(estado)) {
    return [exclusiva('sintese', 'Síntese'), ...ETAPAS_COLETA.filter((k) => coleta[k]).map((k) => etapa(k))];
  }
  if (!erro) return [];
  switch (estado) {
    case 'recebida':
      return [exclusiva('coleta_minima', 'Coleta mínima')];
    case 'coleta_minima': {
      const opcoes = etapasNaoConcluidas(ETAPAS_MINIMAS, coleta);
      if (ETAPAS_MINIMAS.every((k) => etapaUsavel(coleta[k]))) opcoes.push(exclusiva('qualificacao', 'Qualificação'));
      return opcoes;
    }
    case 'coletando': {
      const opcoes = etapasNaoConcluidas(ETAPAS_COLETA, coleta);
      if (ETAPAS_COLETA.every((k) => etapaUsavel(coleta[k]))) opcoes.push(exclusiva('sintese', 'Síntese'));
      return opcoes;
    }
    case 'coletada':
    case 'sintetizando':
      return [exclusiva('sintese', 'Síntese')];
    case 'qualificada':
      return erro.etapa === 'graduar' ? [exclusiva('qualificacao', 'Qualificação')] : [];
    default:
      return [];
  }
}

// ---------- Multiple-choice selector (spec 05 §5.7 and §5.9, variant) ----------
const emOrdem = (opcoes: OpcaoReexecutar[], alvos: string[]) => opcoes.map((o) => o.alvo).filter((a) => alvos.includes(a));

/**
 * What is ticked, given the options and what the administrator chose so far (`null`: nothing chosen yet).
 * Stages that run anyway (`rodaJunto`) are always ticked; with a single option and no choice made, it comes ticked;
 * a choice is cut to the options that still exist, and an exclusive option stands alone.
 */
export function marcadasValidas(opcoes: OpcaoReexecutar[], escolha: string[] | null): string[] {
  const travadas = opcoes.filter((o) => o.rodaJunto).map((o) => o.alvo);
  if (escolha === null) return opcoes.length === 1 ? [opcoes[0].alvo] : travadas;
  const validas = emOrdem(opcoes, [...escolha, ...travadas]);
  const excl = validas.find((a) => opcoes.find((o) => o.alvo === a)?.exclusiva);
  return excl && validas.length > 1 ? [excl] : validas;
}

/**
 * Result of tapping an option: an exclusive option (Síntese, Qualificação, Coleta mínima) clears the others, a stage clears
 * the exclusive ones, tapping a ticked option unticks it, and a locked stage (`rodaJunto`) does not change.
 */
export function marcar(opcoes: OpcaoReexecutar[], marcadas: string[], alvo: string): string[] {
  const op = opcoes.find((o) => o.alvo === alvo);
  if (!op || op.rodaJunto) return marcadas;
  if (marcadas.includes(alvo)) return marcadas.filter((a) => a !== alvo);
  if (op.exclusiva) return [alvo];
  return emOrdem(opcoes, [...marcadas.filter((a) => !opcoes.find((o) => o.alvo === a)?.exclusiva), alvo]);
}

/** Value of the closed field: the ticked labels separated by commas, or "Escolha as etapas". */
export function valorCampo(opcoes: OpcaoReexecutar[], marcadas: string[]): string {
  const rotulos = opcoes.filter((o) => marcadas.includes(o.alvo)).map((o) => o.rotulo);
  return rotulos.length ? rotulos.join(', ') : TEXTO_VAZIO_REEXECUTAR;
}
