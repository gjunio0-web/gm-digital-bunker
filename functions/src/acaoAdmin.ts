// acaoAdmin (spec 01 v0.27, section 4.1): the callable the admin hub uses to act on a ficha.
// One function, onCall, region southamerica-east1, admin only (usuarios/{uid}.papel = admin).
// Phase 5a: aprovar, respostaEnviada, mandarParaAnalise and arquivar. Phase 5b, first part: editar and
// portaDecidida. Phase 5b, second part: reexecutar with the alvos sintese and qualificacao; a list of collection
// stages (phase C) puts the chosen stages in pendente and hands the ficha to coletar or retomarColetaMinima.
// Every action runs in a transaction that rereads estado and estadoEm (the same lock the pipeline uses).
// Errors are HttpsError with details {codigo, estadoAtual?, campo?}; the raw message of an unexpected
// error is never returned, and nothing personal goes to the logs.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp, type Firestore, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import { DIA_MS, ORIGENS_POR_PROJETO, REGIAO, type Pipeline } from './config.js';
import { expurgarFicha } from './expurgar.js';
import { SECOES_MODELO, TITULOS, secaoS0, type SecaoModelo } from './sintese.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import { diaDeSaoPaulo } from './graduar.js';
import { lePipeline } from './pipeline.js';
import { ETAPAS } from './coleta/etapas.js';

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
    case 'reexecutar': ok = ESTADOS_ANALISADA.includes(estado) || ((ESTADOS_LONGOS.includes(estado) || estado === 'coletada' || estado === 'qualificada') && erro); break;
    case 'portaDecidida': ok = ESTADOS_ANALISADA.includes(estado) || estado === 'respondida'; break;
    case 'respostaEnviada': ok = estado === 'aprovada'; break;
    case 'mandarParaAnalise': ok = estado === 'resposta_breve' || (estado === 'qualificada' && Boolean(f.retencao)); break;
    case 'arquivar': ok = true; break; // every state but arquivada; long states were handled above
  }
  if (!ok) throw invalida();
}

// `alvo` of reexecutar (spec 01 v0.30, 4.1, item 3). Checks the shape (non-empty list, no repetition, known values,
// sintese and qualificacao only alone) and, for those two, the states where they are valid. Returns the kind of
// request; a list of collection stages is only shape-checked here.
export const ALVOS = ['sintese', 'qualificacao', ...ETAPAS] as const;
export function validaAlvo(alvo: unknown, f: { estado: string; erro?: { etapa?: string } | null }): { tipo: 'sintese' | 'qualificacao' | 'coleta'; alvos: string[] } {
  const invalido = () => new ErroAcao('parametro_invalido', { campo: 'alvo' });
  if (!Array.isArray(alvo) || alvo.length === 0 || alvo.some((v) => typeof v !== 'string' || !(ALVOS as readonly string[]).includes(v))) throw invalido();
  const alvos = alvo as string[];
  if (new Set(alvos).size !== alvos.length) throw invalido();
  const exclusivo = alvos.includes('sintese') || alvos.includes('qualificacao');
  if (exclusivo && alvos.length > 1) throw invalido();
  if (alvos[0] === 'sintese') {
    if (!(ESTADOS_ANALISADA.includes(f.estado) || ((f.estado === 'sintetizando' || f.estado === 'coletada') && f.erro))) throw invalido();
    return { tipo: 'sintese', alvos };
  }
  if (alvos[0] === 'qualificacao') {
    const etapa = f.erro?.etapa;
    if (!((f.estado === 'coleta_minima' && etapa === 'qualificar') || (f.estado === 'qualificada' && etapa === 'graduar'))) throw invalido();
    return { tipo: 'qualificacao', alvos };
  }
  // Collection stages (spec 01 v0.33, 4.1, item 3; spec 05, 5.7): in the analysed states any of the six; with erro in
  // coleta_minima only the two minimal stages; with erro in coletando any of the six. With erro in the synthesis phase
  // (sintetizando, coletada) and in qualificada only sintese or qualificacao is accepted.
  const erroDeColeta = Boolean(f.erro) && (f.estado === 'coleta_minima' || f.estado === 'coletando');
  if (!(ESTADOS_ANALISADA.includes(f.estado) || erroDeColeta)) throw invalido();
  if (f.estado === 'coleta_minima' && alvos.some((a) => a !== 'empresa_digital' && a !== 'empresa_registro')) throw invalido();
  return { tipo: 'coleta', alvos };
}

// Status of each stage document, read inside the transaction (undefined when the document does not exist). In the
// analysed states every stage is a valid target; with erro only the stages that did not finish (falhou, pendente or
// executando) are offered, so a concluida one is refused. Throws parametro_invalido.
export function validaStatusColeta(alvos: string[], f: { estado: string }, status: Record<string, string | undefined>): void {
  const invalido = () => new ErroAcao('parametro_invalido', { campo: 'alvo' });
  for (const a of alvos) {
    const st = status[a];
    if (!st) throw invalido();
    if (!ESTADOS_ANALISADA.includes(f.estado) && !['falhou', 'pendente', 'executando'].includes(st)) throw invalido();
  }
}

export const PORTAS = ['projeto', 'conselho', 'workshop', 'combinacao', 'nenhuma'] as const;
export const MAX_CORPO_EDICAO = 20_000;
const SUFIXO_EDICAO = ' · edição humana';

// Model shown in the "Modelo" line of s0 of an edited version (spec 01, 4.1, item 5): the model of vN followed by
// " · edição humana". Read from the s0 text of vN (an edit of an edit keeps one suffix); falls back to the author.
export function modeloDaEdicao(base: { autor?: { tipo?: string; id?: string }; secoes?: Record<string, { corpo?: string }> }): string {
  const linha = /\*\*Modelo:\*\* (.+)$/m.exec(base.secoes?.s0?.corpo ?? '')?.[1]?.trim();
  const modelo = (linha ?? (base.autor?.tipo === 'ia' ? base.autor.id : null) ?? 'não informado').replace(/( · edição humana)+$/, '');
  return modelo + SUFIXO_EDICAO;
}

export interface Entrada { uid: string | null; fichaId: unknown; acao: unknown; parametros: unknown }
export interface Saida { ok: true; estado: string; analiseAtual?: string | null }
// Test seams: a hook between the first read and the transaction (to provoke "conflito"), and the clock.
export interface Ganchos { antesDaTransacao?: () => Promise<void>; agora?: Date }

type Ficha = { estado: string; [campo: string]: any };

const evento = (tx: Transaction, ref: DocumentReference, uid: string, em: Timestamp, tipo: string, detalhe: Record<string, unknown> = {}) =>
  tx.create(ref.collection('eventos').doc(), { em, ator: { tipo: 'humano', id: uid }, tipo, detalhe });

// Reads vN and builds vN+1 for an edit (spec 01, 4.1, item 5). Runs inside the transaction, before any write.
async function prepararEdicao(tx: Transaction, ref: DocumentReference, uid: string, f: Ficha, parametros: Record<string, unknown>) {
  const baseadaEm = parametros.baseadaEm as string;
  if (baseadaEm !== f.analiseAtual) throw new ErroAcao('conflito');
  const [base, todas] = await Promise.all([tx.get(ref.collection('analise').doc(baseadaEm)), tx.get(ref.collection('analise'))]);
  const a = base.data();
  if (!a) throw new ErroAcao('interno');
  const secao = parametros.secao as SecaoModelo;
  const versao = `v${todas.size + 1}`;
  const criadaEm = new Date();
  const s0 = secaoS0({
    empresa: f.original?.empresa ?? '', rotuloCargo: CARGOS_ROTULO[f.original?.cargo as string] ?? f.original?.cargo ?? '',
    recebidaEm: (f.recebidaEm as Timestamp).toDate(), criadaEm, versao, lead: f.lead, versaoMetodo: a.versaoMetodo ?? '', modelo: modeloDaEdicao(a),
  });
  // The title is always the fixed one of the section, never the client's; the edited section is not "vazia".
  const secoes = { ...(a.secoes ?? {}), s0, [secao]: { titulo: TITULOS[secao], corpo: parametros.corpo, vazia: false, motivoVazia: null } };
  const copia = Object.fromEntries(['enquadramento', 'resumoExecutivo', 'conversa', 'rascunhoResposta'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
  return { versao, doc: { autor: { tipo: 'humano', id: uid, origem: 'edicao' }, baseadaEm, versaoMetodo: a.versaoMetodo ?? null, secoes, ...copia } as Record<string, unknown> };
}

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

  if (acao === 'portaDecidida' && !(PORTAS as readonly unknown[]).includes(parametros.porta)) throw new ErroAcao('parametro_invalido', { campo: 'porta' });
  if (acao === 'editar') {
    if (typeof parametros.secao !== 'string' || !(SECOES_MODELO as readonly string[]).includes(parametros.secao)) throw new ErroAcao('parametro_invalido', { campo: 'secao' });
    if (typeof parametros.corpo !== 'string' || !parametros.corpo.trim() || parametros.corpo.length > MAX_CORPO_EDICAO) throw new ErroAcao('parametro_invalido', { campo: 'corpo' });
    if (typeof parametros.baseadaEm !== 'string' || !parametros.baseadaEm || parametros.baseadaEm.includes('/')) throw new ErroAcao('parametro_invalido', { campo: 'baseadaEm' });
  }

  const ref = db.collection('fichas').doc(fichaId);
  const lida = await ref.get();
  if (!lida.exists) throw new ErroAcao('ficha_inexistente');
  const f0 = lida.data() as Ficha;
  validaEstado(acao as Acao, f0);
  if (acao === 'reexecutar') validaAlvo(parametros.alvo, f0);
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
    const edicao = acao === 'editar' ? await prepararEdicao(tx, ref, uid, f, parametros) : null;
    const conta = acao === 'mandarParaAnalise' && p.maxAnalisesPorDia !== null ? await tx.get(contador) : null;

    switch (acao) {
      case 'aprovar':
        tx.update(ref, { estado: 'aprovada', estadoEm: em });
        evento(tx, ref, uid, em, 'aprovada');
        return { ok: true, estado: 'aprovada', analiseAtual: f.analiseAtual ?? null };

      case 'portaDecidida': {
        const de = (f.portaDecidida as string | null | undefined) ?? null;
        // The same door again answers ok, with no write and no event (spec 01, 4.1, item 4).
        if (de === parametros.porta) return { ok: true, estado: f.estado, analiseAtual: f.analiseAtual ?? null };
        tx.update(ref, { portaDecidida: parametros.porta });
        evento(tx, ref, uid, em, 'porta_decidida', { de, para: parametros.porta });
        return { ok: true, estado: f.estado, analiseAtual: f.analiseAtual ?? null };
      }

      case 'editar': {
        const { versao, doc } = edicao!;
        tx.create(ref.collection('analise').doc(versao), { ...doc, criadaEm: em });
        tx.update(ref, { analiseAtual: versao });
        evento(tx, ref, uid, em, 'editada', { secao: parametros.secao, baseadaEm: parametros.baseadaEm, versao });
        return { ok: true, estado: f.estado, analiseAtual: versao };
      }

      case 'reexecutar': {
        // Re-checked on the data read inside the transaction (vigiar can set erro without touching estadoEm).
        validaEstado('reexecutar', f);
        const { tipo, alvos } = validaAlvo(parametros.alvo, f);
        if (tipo === 'coleta') {
          // Stage documents are read before any write. They go to pendente keeping their content (the previous data
          // that coletar reads and preserves); coletar (or retomarColetaMinima in coleta_minima) takes over.
          const refs = alvos.map((a) => ref.collection('coleta').doc(a));
          const docs = await Promise.all(refs.map((r) => tx.get(r)));
          validaStatusColeta(alvos, f, Object.fromEntries(alvos.map((a, i) => [a, docs[i].get('status') as string | undefined])));
          for (const r of refs) tx.update(r, { status: 'pendente' });
          const estado = f.estado === 'coleta_minima' ? 'coleta_minima' : 'coletando';
          tx.update(ref, { estado, estadoEm: em, erro: null });
          evento(tx, ref, uid, em, 'reexecucao', { alvos });
          return { ok: true, estado, analiseAtual: f.analiseAtual ?? null };
        }
        // estadoEm is renewed in both cases: vigiar measures a stop from it. sintese goes back to coletada and
        // sintetizar takes over; qualificacao keeps the state and retomarTriagem takes over (erro goes to null).
        if (tipo === 'sintese') tx.update(ref, { estado: 'coletada', estadoEm: em, erro: null });
        else tx.update(ref, { estadoEm: em, erro: null });
        // qualificacao on a ficha that already has lead: the triagem is done, retomarTriagem does nothing, and the action
        // only cleared erro (spec 01 v0.39); the event says so.
        evento(tx, ref, uid, em, 'reexecucao', tipo === 'qualificacao' && f.lead ? { alvos, apenasLimpouErro: true } : { alvos });
        return { ok: true, estado: tipo === 'sintese' ? 'coletada' : f.estado, analiseAtual: f.analiseAtual ?? null };
      }

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
          // prazoEm goes back to null: the triagem deadline of a Declinar ficha no longer applies, and the first graduar of the
          // analysis and confiancaFinal set the deadline of the analysis (spec 01, rule of prazoEm). A held ficha needs no reset: its prazoEm is born null.
          tx.update(ref, { estado: 'coletando', estadoEm: em, 'lead.destinoAlterado': true, 'lead.acao.prazoEm': null, expurgoEm: Timestamp.fromMillis(Math.max(normal, atual)) });
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
