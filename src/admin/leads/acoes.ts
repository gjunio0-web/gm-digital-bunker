// Admin actions (spec 05 §5.7 and §5.7.1; spec 01 §4.1). Pure rules: which actions the bar offers in a state, what the
// function answers mean on screen, and the one-shot notice shown on the list after an action. The call itself is
// `chamaAcao` (app.ts); nothing here touches Firebase or the DOM.
import { ESTADO } from './regras';
import { alvosReexecutar } from './reexecutar';

type Obj = Record<string, any>;

/** Names of the actions as `acaoAdmin` receives them (spec 01 §4.1, item 1). */
export type Acao = 'aprovar' | 'editar' | 'reexecutar' | 'portaDecidida' | 'respostaEnviada' | 'mandarParaAnalise' | 'arquivar';

/** Call of the function: resolves with the confirmation, rejects with the SDK error. Injected, so tests need no network. */
export type ChamaAcao = (fichaId: string, acao: Acao, parametros?: Record<string, unknown>) => Promise<{ ok: boolean; estado?: string; analiseAtual?: string | null }>;

/** Buttons of the bar, in the order of the mock-up. */
export type ItemBarra = 'mandar' | 'aprovar' | 'resposta' | 'editar' | 'porta' | 'reexecutar' | 'arquivar';

/** State a repeated action leaves behind: when the function answers acao_invalida_no_estado with this state, the hub shows no error. */
export const ESTADO_PRODUZIDO: Partial<Record<Acao, string>> = {
  aprovar: 'aprovada', respostaEnviada: 'respondida', mandarParaAnalise: 'coletando', arquivar: 'arquivada',
};

/** Action of the function behind each button (porta, reexecutar and editar open a control first, except in tests). */
export const ACAO_DO_ITEM: Record<ItemBarra, Acao> = {
  mandar: 'mandarParaAnalise', aprovar: 'aprovar', resposta: 'respostaEnviada', editar: 'editar',
  porta: 'portaDecidida', reexecutar: 'reexecutar', arquivar: 'arquivar',
};

/**
 * Buttons of the action bar for a ficha (spec 05 §5.7, table). Reexecutar is offered only when `alvosReexecutar` has at
 * least one option, so the bar never shows a selector with nothing to choose; the function stays the authority.
 * Empty list: no action (long state without erro, Arquivada, unknown state).
 */
export function acoesDaBarra(ficha: Obj, coleta: Record<string, Obj> = {}): ItemBarra[] {
  const estado = String(ficha.estado ?? '');
  const erro = ficha.erro ?? null;
  const reex = alvosReexecutar(estado, erro, coleta).length > 0;
  switch (estado) {
    case 'recebida': return [...(reex ? ['reexecutar' as const] : []), 'arquivar'];
    case 'coleta_minima': case 'coletando': case 'sintetizando': return erro ? [...(reex ? ['reexecutar' as const] : []), 'arquivar'] : [];
    case 'qualificada': return [...(ficha.retencao ? ['mandar' as const] : []), ...(reex ? ['reexecutar' as const] : []), 'arquivar'];
    case 'descartada': return ['arquivar'];
    case 'resposta_breve': return ['mandar', 'arquivar'];
    case 'coletada': return [...(reex ? ['reexecutar' as const] : []), 'arquivar'];
    case 'analise_pronta': case 'analise_com_pendencias': return ['aprovar', 'editar', 'porta', 'reexecutar', 'arquivar'];
    case 'aprovada': return ['resposta', 'editar', 'porta', 'reexecutar', 'arquivar'];
    case 'respondida': return ['porta', 'arquivar'];
    default: return [];
  }
}

/** The main action of the state, the only cobalt button of the screen (spec 05 §5.7, table). */
export function acaoPrincipal(estado: string): ItemBarra | null {
  return estado === 'analise_pronta' || estado === 'analise_com_pendencias' ? 'aprovar' : estado === 'aprovada' ? 'resposta' : null;
}

// ---------- Errors (spec 05 §5.7.1; texts approved by Gon, changed only by his decision) ----------
export const TEXTO_ERRO: Record<string, string> = {
  nao_autenticado: 'Sua sessão expirou. Entre de novo.',
  sem_permissao: 'Esta conta não tem permissão para esta ação.',
  ficha_inexistente: 'Esta ficha não existe mais.',
  ficha_em_processamento: 'A ficha está sendo processada. Tente de novo quando ela terminar.',
  conflito: 'A ficha mudou durante a ação. Confira o estado e tente de novo.',
  interno: 'Não foi possível concluir a ação. Tente de novo; se o erro se repetir, avise quem administra o sistema.',
};
export const TEXTO_CONFLITO_EDITAR = 'A análise mudou enquanto você editava. Seu texto foi mantido aqui; copie-o ou abra a versão atual.';

/** Names on screen of the parameters the function can refuse (spec 05 §5.7.1, `parametro_invalido`). */
export const CAMPO_NA_TELA: Record<string, string> = {
  alvo: 'Reexecutar', porta: 'Porta', secao: 'Seção', corpo: 'Texto', baseadaEm: 'Versão', expurgoImediato: 'Apagar agora',
};

export interface ResultadoAcao {
  /** `sucesso`: nothing to show (the screen follows the Firestore listener); `erro`: show `texto` in an alert. */
  tipo: 'sucesso' | 'erro';
  texto: string;
  /** `ficha_inexistente`: the ficha is gone, so the hub goes back to the list with the text as a notice. */
  voltarLista: boolean;
}

/** The `details` of the function error (HttpsError); anything else, such as a network failure, has none. */
function detalhes(err: unknown): Obj {
  const d = (err as { details?: unknown } | null)?.details;
  return d && typeof d === 'object' ? (d as Obj) : {};
}

/**
 * Turns the error of a call into what the page shows. Reads only `details.codigo`, never the raw message of the
 * function. An unknown or missing code (network failure, unexpected answer) shows the text of `interno`.
 */
export function tratarErroAcao(err: unknown, acao: Acao): ResultadoAcao {
  const d = detalhes(err);
  const codigo = typeof d.codigo === 'string' ? d.codigo : '';
  const erro = (texto: string, voltarLista = false): ResultadoAcao => ({ tipo: 'erro', texto, voltarLista });
  if (codigo === 'acao_invalida_no_estado') {
    const atual = typeof d.estadoAtual === 'string' ? d.estadoAtual : '';
    if (atual && ESTADO_PRODUZIDO[acao] === atual) return { tipo: 'sucesso', texto: '', voltarLista: false };
    return erro(ESTADO[atual] ? `Esta ação não vale mais para a ficha, que agora está em ${ESTADO[atual]}.` : 'Esta ação não vale mais para a ficha.');
  }
  if (codigo === 'parametro_invalido') {
    const campo = typeof d.campo === 'string' ? CAMPO_NA_TELA[d.campo] : undefined;
    return erro(campo ? `O valor de ${campo} não foi aceito.` : 'O valor enviado não foi aceito.');
  }
  if (codigo === 'conflito' && acao === 'editar') return erro(TEXTO_CONFLITO_EDITAR);
  if (codigo === 'ficha_inexistente') return erro(TEXTO_ERRO.ficha_inexistente, true);
  return erro(TEXTO_ERRO[codigo] ?? TEXTO_ERRO.interno);
}

// ---------- Notice for the next list (a one-shot message that survives the change of route) ----------
let avisoLista = '';
export function definirAvisoLista(texto: string): void { avisoLista = texto; }
/** Reads and clears the notice. */
export function consumirAvisoLista(): string { const t = avisoLista; avisoLista = ''; return t; }
