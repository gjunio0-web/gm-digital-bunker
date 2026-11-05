// qualificar – Firestore trigger on new fichas (spec 01, sections 2 to 4 and decision 2; spec 02, section 1).
// Signals and rules in code; a short Claude call only when there is a message or the role is "other".
// Idempotent: leaves at once if the ficha already has qualificacao or is no longer "recebida"; the final
// write is a transaction that gives up if estadoEm changed meanwhile (another instance got there first).
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { CLAUDE_API_KEY, DIA_MS, REGIAO } from './config.js';
import { lePipeline } from './pipeline.js';
import { chamaClaude, noEmulador, simulaClassificacao } from './claude.js';
import { custoDe, type Custo } from './custo.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import {
  decide, ESQUEMA_CLASSIFICACAO, precisaModelo, promptQualificacao, sinais, validaClassificacao, type Classificacao,
} from './qualificacao.js';
import type { Normalizado, Original } from './validacao.js';

// Month key of metricas in São Paulo time (aaaa-mm).
const mesDe = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);

export const qualificar = onDocumentCreated(
  { document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY], memory: '256MiB', timeoutSeconds: 120, maxInstances: 5, retry: false },
  async (evento) => {
    const id = evento.params.id;
    const db = getFirestore();
    const ref = db.collection('fichas').doc(id);
    try {
      const snap = await ref.get();
      const f = snap.data();
      if (!f || f.qualificacao || f.estado !== 'recebida') return;
      const estadoEmLido = f.estadoEm as Timestamp;
      const original = f.original as Original;
      const normalizado = f.normalizado as Normalizado;
      const p = await lePipeline();

      const s = sinais(original, normalizado);
      let classificacao: Classificacao | null = null;
      let custo: Custo = { tokensEntrada: 0, tokensSaida: 0, buscas: 0, usdEstimado: 0 };
      if (precisaModelo(original, s)) {
        if (!noEmulador() && !p.modeloColeta) throw new Error('config/pipeline.modeloColeta is empty');
        const r = noEmulador()
          ? simulaClassificacao(original.mensagem)
          : await chamaClaude({
              chave: CLAUDE_API_KEY.value(),
              modelo: p.modeloColeta,
              usuario: promptQualificacao(original, normalizado, CARGOS_ROTULO[original.cargo] ?? original.cargo),
              esquema: ESQUEMA_CLASSIFICACAO,
            });
        classificacao = validaClassificacao(r.json);
        custo = custoDe(p.modeloColeta, r.uso);
      }
      const { decisao, motivo } = decide(s, classificacao);
      const estado =
        decisao === 'descartar' ? 'descartada' : decisao === 'responder_breve' ? 'resposta_breve' : p.autoAnalisar ? 'coletando' : 'qualificada';

      const agora = Timestamp.now();
      const recebidaEm = f.recebidaEm as Timestamp;
      let desistiu = false;
      await db.runTransaction(async (tx) => {
        const atual = (await tx.get(ref)).data();
        if (!atual || atual.qualificacao || atual.estado !== 'recebida' || !(atual.estadoEm as Timestamp).isEqual(estadoEmLido)) {
          desistiu = true;
          return;
        }
        tx.update(ref, {
          qualificacao: { decisao, motivo, ...s, classificacaoMensagem: classificacao },
          custo,
          estado,
          estadoEm: agora,
          ...(decisao === 'analisar' ? {} : { expurgoEm: Timestamp.fromMillis(recebidaEm.toMillis() + p.prazoGuardaDiasBreve * DIA_MS) }),
        });
        tx.create(ref.collection('eventos').doc(), {
          em: agora,
          ator: { tipo: 'sistema', id: 'qualificar' },
          tipo: 'qualificada',
          detalhe: { decisao, motivo },
        });
        tx.set(
          db.collection('metricas').doc(mesDe(recebidaEm.toDate())),
          { qualificacao: { [decisao]: FieldValue.increment(1) }, atualizadoEm: agora },
          { merge: true },
        );
      });
      logger.info(desistiu ? 'qualificar: already handled' : 'qualificar: done', { id, decisao, estado, usd: custo.usdEstimado });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('qualificar failed', { id, mensagem });
      await ref.update({ erro: { etapa: 'qualificar', mensagem, em: Timestamp.now() } }).catch(() => undefined);
    }
  },
);
