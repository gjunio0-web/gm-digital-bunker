// retomarTriagem – runs when acaoAdmin clears erro of a ficha that stopped in the triagem (spec 01, section 4.1,
// item 3, alvo "qualificacao"): in coleta_minima it redoes qualificar and graduar; in qualificada without lead
// (erro.etapa = graduar) it redoes graduar. It does nothing while a coleta mínima stage is not finished: that
// case belongs to the empresa_digital / empresa_registro targets. The locks are those of qualifica and
// graduaTriagem (estado and estadoEm inside a transaction), so a second delivery does nothing.
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { APOLLO_API_KEY, CLAUDE_API_KEY, REGIAO, SMTP2GO_API_KEY } from './config.js';
import { lePipeline } from './pipeline.js';
import { noEmulador } from './claude.js';
import { ETAPAS_MINIMAS } from './coleta/etapas.js';
import { etapaUsavel } from './coleta/preservacao.js';
import { concluiTriagem } from './triagem.js';

type Ficha = { estado?: string; erro?: unknown; lead?: unknown } | undefined;

// Pure trigger condition: erro went from filled to null, in a state where the triagem is what is missing.
export function deveRetomar(antes: Ficha, depois: Ficha): 'qualificar' | 'graduar' | null {
  if (!antes?.erro || !depois || depois.erro) return null;
  if (depois.estado === 'coleta_minima') return 'qualificar';
  if (depois.estado === 'qualificada' && !depois.lead) return 'graduar';
  return null;
}

// The triagem can go on when every minimal stage is concluida or nao_aplicavel, or usable (falhou with the whole stage
// preserved; spec 01 v0.33). A stage pendente, executando or falhou without preservado makes it give up.
export function triagemPodeSeguir(etapas: { status?: unknown; preservado?: { blocos?: unknown } | null }[]): boolean {
  return etapas.every((d) => ['concluida', 'nao_aplicavel'].includes(d.status as string) || etapaUsavel(d));
}

export const retomarTriagem = onDocumentUpdated(
  { document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY, APOLLO_API_KEY, SMTP2GO_API_KEY], memory: '1GiB', timeoutSeconds: 540, maxInstances: 3, retry: false },
  async (evento) => {
    const depois = evento.data?.after.data();
    const inicio = deveRetomar(evento.data?.before.data(), depois);
    if (!inicio || !depois) return;
    const id = evento.params.id;
    const ref = getFirestore().collection('fichas').doc(id);
    let etapa: string = inicio;
    try {
      const docs = await Promise.all(ETAPAS_MINIMAS.map((e) => ref.collection('coleta').doc(e).get()));
      if (!triagemPodeSeguir(docs.map((d) => d.data() ?? {}))) return;
      const p = await lePipeline();
      const { decisao, g } = await concluiTriagem(
        ref, id, p, { claude: noEmulador() ? '' : CLAUDE_API_KEY.value(), smtp: noEmulador() ? '' : SMTP2GO_API_KEY.value() }, inicio === 'qualificar', (e) => { etapa = e; },
      );
      logger.info('retomarTriagem: done', { id, decisao, quadrante: g?.lead.quadrante, grau: g?.lead.grau, estado: g?.estado });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('retomarTriagem failed', { id, etapa, mensagem });
      await ref.update({ erro: { etapa, mensagem, em: Timestamp.now() } }).catch(() => undefined);
    }
  },
);
