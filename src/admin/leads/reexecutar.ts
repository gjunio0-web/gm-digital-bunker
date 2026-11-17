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
const DESCRICAO_COLETA_MINIMA = 'Recomeça a coleta mínima desde o início.';

const exclusiva = (alvo: string, rotulo: string, descricao = ''): OpcaoReexecutar => ({ alvo, rotulo, descricao, rodaJunto: false, exclusiva: true });
const etapa = (alvo: string, rodaJunto = false): OpcaoReexecutar => ({ alvo, rotulo: ETAPA_COLETA[alvo] ?? alvo, descricao: '', rodaJunto, exclusiva: false });

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
      return [exclusiva('coleta_minima', 'Coleta mínima', DESCRICAO_COLETA_MINIMA)];
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
