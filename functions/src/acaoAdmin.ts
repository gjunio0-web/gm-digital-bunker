// acaoAdmin (spec 01 v0.27, section 4.1): the callable the admin hub uses to act on a ficha.
// One function, onCall, region southamerica-east1, admin only (usuarios/{uid}.papel = admin).
// Phase 5a: aprovar, respostaEnviada, mandarParaAnalise and arquivar. editar, portaDecidida and reexecutar are
// validated against the state table but answer "interno" until phase 5b.
// Every action runs in a transaction that rereads estado and estadoEm (the same lock the pipeline uses).
// Errors are HttpsError with details {codigo, estadoAtual?, campo?}; the raw message of an unexpected
// error is never returned, and nothing personal goes to the logs.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp, type Firestore, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import { DIA_MS, ORIGENS_POR_PROJETO, REGIAO, type Pipeline } from './config.js';
import { expurgarFicha } from './expurgar.js';
import { diaDeSaoPaulo } from './graduar.js';
import { lePipeline } from './pipeline.js';

export const ACOES = ['aprovar', 'editar', 'reexecutar', 'portaDecidida', 'respostaEnviada', 'mandarParaAnalise', 'arquivar'] as const;
export type Acao = (typeof ACOES)[number];

export type CodigoErro =
  | 'nao_autenticado' | 'sem_permissao' | 'ficha_inexistente' | 'acao_invalida_no_estado'
  | 'parametro_invalido' | 'ficha_em_processamento' | 'conflito' | 'interno';

// Long states (spec 01, section 4.1, item 6): without erro there is an execution in progress.
const ESTADOS_LONGOS = ['coleta_minima', 'coletando', 'sintetizando'];
const ESTADOS_ANALISADA = ['analise_pronta', 'analise_com_pendencias', 'aprovada'];

export class ErroAcao extends Error {
  constructor(public codigo: CodigoErro, public extra: { estadoAtual?: string; campo?: string } = {}) {
    super(codigo);
  }
}

const HTTPS: Record<CodigoErro, ConstructorParameters<typeof HttpsError>[0]> = {
  nao_autenticado: 'unauthenticated',
  sem_permissao: 'permission-denied',
  ficha_inexistente: 'not-found',
  acao_invalida_no_estado: 'failed-precondition',
  parametro_invalido: 'invalid-argument',
  ficha_em_processamento: 'failed-precondition',
  conflito: 'aborted',
  interno: 'internal',
};

// Short messages in Portuguese, without personal data; the hub shows its own fixed texts (spec 05, 5.7.1).
const MENSAGEM: Record<CodigoErro, string> = {
  nao_autenticado: 'É preciso entrar para executar esta ação.',
  sem_permissao: 'Sem permissão para esta ação.',
  ficha_inexistente: 'Ficha não encontrada.',
  acao_invalida_no_estado: 'Esta ação não está disponível no estado atual da ficha.',
  parametro_invalido: 'Parâmetro inválido.',
  ficha_em_processamento: 'A ficha está sendo processada.',
  conflito: 'A ficha mudou durante a ação. Tente de novo.',
  interno: 'Erro interno. Tente de novo mais tarde.',
};

// Any error becomes an HttpsError; an unexpected one becomes "interno" with no trace of its own message.
export function paraHttpsError(e: unknown): HttpsError {
  const erro = e instanceof ErroAcao ? e : new ErroAcao('interno');
  if (!(e instanceof ErroAcao)) logger.error('acaoAdmin: unexpected error', { nome: (e as Error)?.name ?? 'desconhecido' });
  return new HttpsError(HTTPS[erro.codigo], MENSAGEM[erro.codigo], { codigo: erro.codigo, ...erro.extra });
}

// State table of section 4.1, item 2, plus the rule of long states (item 6). Throws ErroAcao.
export function validaEstado(acao: Acao, f: { estado: string; erro?: unknown; retencao?: unknown }): void {
  const { estado } = f;
  const erro = Boolean(f.erro);
  const invalida = () => new ErroAcao('acao_invalida_no_estado', { estadoAtual: estado });
  if (estado === 'arquivada') throw invalida();
  // Long states without erro: every action is refused (an execution is in progress).
  if (ESTADOS_LONGOS.includes(estado) && !erro) throw new ErroAcao('ficha_em_processamento', { estadoAtual: estado });
  let ok: boolean;
  switch (acao) {
    case 'aprovar': ok = estado === 'analise_pronta' || estado === 'analise_com_pendencias'; break;
    case 'editar': ok = ESTADOS_ANALISADA.includes(estado); break;
    case 'reexecutar': ok = ESTADOS_ANALISADA.includes(estado) || ((ESTADOS_LONGOS.includes(estado) || estado === 'coletada') && erro); break;
    case 'portaDecidida': ok = ESTADOS_ANALISADA.includes(estado) || estado === 'respondida'; break;
    case 'respostaEnviada': ok = estado === 'aprovada'; break;
    case 'mandarParaAnalise': ok = estado === 'resposta_breve' || (estado === 'qualificada' && Boolean(f.retencao)); break;
    case 'arquivar': ok = true; break; // every state but arquivada; long states were handled above
  }
  if (!ok) throw invalida();
}

export interface Entrada { uid: string | null; fichaId: unknown; acao: unknown; parametros: unknown }
export interface Saida { ok: true; estado: string; analiseAtual?: string | null }
// Test seams: a hook between the first read and the transaction (to provoke "conflito"), and the clock.
export interface Ganchos { antesDaTransacao?: () => Promise<void>; agora?: Date }

type Ficha = { estado: string; [campo: string]: any };

const evento = (tx: Transaction, ref: DocumentReference, uid: string, em: Timestamp, tipo: string, detalhe: Record<string, unknown> = {}) =>
  tx.create(ref.collection('eventos').doc(), { em, ator: { tipo: 'humano', id: uid }, tipo, detalhe });

export async function executaAcao(
  db: Firestore,
  p: Pick<Pipeline, 'prazoGuardaDias' | 'maxAnalisesPorDia'>,
  entrada: Entrada,
  ganchos: Ganchos = {},
): Promise<Saida> {
  if (!entrada.uid) throw new ErroAcao('nao_autenticado');
  const uid = entrada.uid;
  const papel = (await db.doc(`usuarios/${uid}`).get()).data()?.papel;
  if (papel !== 'admin') throw new ErroAcao('sem_permissao');

  const { fichaId, acao } = entrada;
  if (typeof fichaId !== 'string' || !fichaId || fichaId.length > 128 || fichaId.includes('/')) throw new ErroAcao('parametro_invalido', { campo: 'fichaId' });
  if (typeof acao !== 'string' || !(ACOES as readonly string[]).includes(acao)) throw new ErroAcao('parametro_invalido', { campo: 'acao' });
  const parametros = typeof entrada.parametros === 'object' && entrada.parametros !== null ? (entrada.parametros as Record<string, unknown>) : {};
  if (acao === 'arquivar' && typeof parametros.expurgoImediato !== 'boolean') throw new ErroAcao('parametro_invalido', { campo: 'expurgoImediato' });

  const ref = db.collection('fichas').doc(fichaId);
  const lida = await ref.get();
  if (!lida.exists) throw new ErroAcao('ficha_inexistente');
  const f0 = lida.data() as Ficha;
  validaEstado(acao as Acao, f0);
  if (acao === 'editar' || acao === 'portaDecidida' || acao === 'reexecutar') {
    logger.warn('acaoAdmin: action not available yet', { acao });
    throw new ErroAcao('interno');
  }
  await ganchos.antesDaTransacao?.();

  const agora = ganchos.agora ?? new Date();
  const em = Timestamp.fromDate(agora);
  const dia = diaDeSaoPaulo(agora);
  const contador = db.collection('controle').doc(`analises-${dia}`);
  const apagar = acao === 'arquivar' && parametros.expurgoImediato === true;

  const saida = await db.runTransaction(async (tx): Promise<Saida> => {
    const f = (await tx.get(ref)).data() as Ficha | undefined;
    // The same lock as the pipeline: if estado or estadoEm changed since the read, the answer is "conflito".
    if (!f) throw new ErroAcao('conflito');
    if (f.estado !== f0.estado || !(f.estadoEm as Timestamp).isEqual(f0.estadoEm as Timestamp)) throw new ErroAcao('conflito');
    const conta = acao === 'mandarParaAnalise' && p.maxAnalisesPorDia !== null ? await tx.get(contador) : null;

    switch (acao) {
      case 'aprovar':
        tx.update(ref, { estado: 'aprovada', estadoEm: em });
        evento(tx, ref, uid, em, 'aprovada');
        return { ok: true, estado: 'aprovada', analiseAtual: f.analiseAtual ?? null };

      case 'respostaEnviada':
        tx.update(ref, { estado: 'respondida', estadoEm: em, respondidaEm: em, expurgoEm: Timestamp.fromMillis(agora.getTime() + p.prazoGuardaDias * DIA_MS) });
        evento(tx, ref, uid, em, 'resposta_enviada');
        return { ok: true, estado: 'respondida', analiseAtual: f.analiseAtual ?? null };

      case 'mandarParaAnalise': {
        // Counts in the day of the ceiling when there is one, and is never stopped by it (spec 01, section 3).
        if (conta) tx.set(contador, { dia, n: FieldValue.increment(1), atualizadoEm: em }, { merge: true });
        if (f.estado === 'resposta_breve') {
          // The score does not change; back to the 90-day retention rule (never shorter than it already is).
          const normal = (f.recebidaEm as Timestamp).toMillis() + p.prazoGuardaDias * DIA_MS;
          const atual = (f.expurgoEm as Timestamp | undefined)?.toMillis() ?? 0;
          tx.update(ref, { estado: 'coletando', estadoEm: em, 'lead.destinoAlterado': true, expurgoEm: Timestamp.fromMillis(Math.max(normal, atual)) });
          evento(tx, ref, uid, em, 'destino_alterado', { estadoAnterior: 'resposta_breve', destino: f.lead?.destino ?? null });
        } else {
          // A held ficha: leaving the retention is not a disagreement with the triagem (lead.destinoAlterado stays).
          tx.update(ref, { estado: 'coletando', estadoEm: em, retencao: null });
          evento(tx, ref, uid, em, 'retencao_liberada', { motivo: f.retencao?.motivo ?? null, modo: 'manual' });
        }
        return { ok: true, estado: 'coletando', analiseAtual: f.analiseAtual ?? null };
      }

      case 'arquivar':
        if (apagar) {
          // estado arquivada with estadoEm makes any running trigger give up by the lock; expurgoEm = now lets
          // the daily purge finish the job if the removal below fails midway.
          tx.update(ref, { estado: 'arquivada', estadoEm: em, expurgoEm: em });
          return { ok: true, estado: 'apagada' };
        }
        tx.update(ref, { estado: 'arquivada', estadoEm: em });
        evento(tx, ref, uid, em, 'arquivada', { expurgoImediato: false });
        return { ok: true, estado: 'arquivada', analiseAtual: f.analiseAtual ?? null };
    }
    throw new ErroAcao('interno');
  });

  if (apagar) {
    try {
      await expurgarFicha(db, ref);
    } catch {
      // The ficha stays arquivada with expurgoEm = now; the daily purge removes it.
      logger.error('acaoAdmin: immediate purge failed');
      throw new ErroAcao('interno');
    }
  }
  return saida;
}

export const acaoAdmin = onCall(
  { region: REGIAO, cors: [...(ORIGENS_POR_PROJETO[process.env.GCLOUD_PROJECT ?? ''] ?? [])], memory: '256MiB', timeoutSeconds: 120 },
  async (req) => {
    try {
      const d = (req.data ?? {}) as Record<string, unknown>;
      return await executaAcao(getFirestore(), await lePipeline(), { uid: req.auth?.uid ?? null, fichaId: d.fichaId, acao: d.acao, parametros: d.parametros });
    } catch (e) {
      throw paraHttpsError(e);
    }
  },
);
