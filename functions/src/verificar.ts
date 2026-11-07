// verificar – runs on the creation of fichas/{id}/analise/{versao} (decision of Gon, 7/11/2026, to be
// recorded in specs 01 and 02): the code checks of spec 02, 4.1 always; the reviewer of 4.2 only when the
// version was written by the AI (autor.tipo = ia), never on a human edit. Writes verificacao in the
// version, then graduar recalculates only the confidence (spec 04, 2.5). For an AI version of the current
// analysis of a ficha in "sintetizando": final state analise_pronta or analise_com_pendencias, prazoEm
// from that moment and the second e-mail to the administrator. A human edit keeps the state and prazoEm.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { CLAUDE_API_KEY, REGIAO, SMTP2GO_API_KEY, URL_BASE_POR_PROJETO } from './config.js';
import { lePipeline } from './pipeline.js';
import { chamaClaude, noEmulador } from './claude.js';
import { custoDe } from './custo.js';
import { leMetodo } from './metodo.js';
import { confiancaFinal } from './graduar.js';
import { avisoAnalise } from './email.js';
import { mesDe } from './qualificar.js';
import { ETAPAS_COLETA, coletaDe, rotuloDestino, rotuloQuadrante } from './sintese.js';
import { ESQUEMA_REVISOR, checagens, mensagemRevisor, validaRevisor, type Pendencia } from './verificacao.js';

const projeto = () => process.env.GCLOUD_PROJECT ?? '';

export const verificar = onDocumentCreated(
  { document: 'fichas/{id}/analise/{versao}', region: REGIAO, secrets: [CLAUDE_API_KEY, SMTP2GO_API_KEY], memory: '1GiB', timeoutSeconds: 540, maxInstances: 3, retry: false },
  async (evento) => {
    const { id, versao } = evento.params;
    const a = evento.data?.data();
    if (!a || a.verificacao) return;
    const db = getFirestore();
    const ref = db.collection('fichas').doc(id);
    const docVersao = ref.collection('analise').doc(versao);
    const ia = a.autor?.tipo === 'ia';
    try {
      const p = await lePipeline();
      const f = (await ref.get()).data();
      if (!f) return;
      const snaps = await Promise.all(ETAPAS_COLETA.map((e) => ref.collection('coleta').doc(e).get()));
      const coleta = coletaDe(Object.fromEntries(ETAPAS_COLETA.map((e, i) => [e, snaps[i].data()])));

      // 4.1 – code checks.
      const pendencias: Pendencia[] = checagens(
        { secoes: a.secoes ?? {}, rascunhoResposta: a.rascunhoResposta ?? { assunto: '', corpo: '' }, lang: f.original?.lang ?? 'pt-BR', cnpjConfirmado: coleta.empresa_registro.status === 'concluida' && (coleta.empresa_registro.conteudo as any)?.confirmado === true },
        coleta,
      );

      // 4.2 – reviewer, AI versions only; no access to the collection.
      let modeloRevisor: string | null = null;
      let custo = { tokensEntrada: 0, tokensSaida: 0, usdEstimado: 0 };
      if (ia) {
        modeloRevisor = noEmulador() ? 'simulado' : p.modeloRevisor;
        if (!noEmulador() && !p.modeloRevisor) throw new Error('config/pipeline.modeloRevisor is empty');
        let revisor: Pendencia[];
        if (noEmulador()) revisor = [];
        else {
          const metodo = await leMetodo({ 'glossario.md': ['B'], 'escopo-limites.md': [1, 4, 5, 7] });
          const r = await chamaClaude({
            chave: CLAUDE_API_KEY.value(), modelo: p.modeloRevisor, metodo: metodo.blocos.map((b) => ({ nome: b.nome, texto: b.texto })),
            usuario: mensagemRevisor(a.secoes ?? {}, a.enquadramento?.detalhe ?? a.enquadramento ?? null), esquema: ESQUEMA_REVISOR, maxTokens: 16_000, timeoutMs: 300_000,
          });
          revisor = validaRevisor(r.json);
          const k = custoDe(p.modeloRevisor, r.uso);
          custo = { tokensEntrada: k.tokensEntrada, tokensSaida: k.tokensSaida, usdEstimado: k.usdEstimado ?? 0 };
        }
        pendencias.push(...revisor);
      }

      const status = pendencias.length ? 'com_pendencias' : 'pronta';
      const agora = Timestamp.now();
      // Final state only for the current AI version of a ficha still in "sintetizando".
      const fecha = ia && f.estado === 'sintetizando' && f.analiseAtual === versao;
      const lead = await confiancaFinal(ref, f, pendencias.length > 0, fecha ? agora.toDate() : null);
      const estado = status === 'pronta' ? 'analise_pronta' : 'analise_com_pendencias';

      await db.runTransaction(async (tx) => {
        const atual = (await tx.get(ref)).data();
        const v = (await tx.get(docVersao)).data();
        if (!atual || !v || v.verificacao) return;
        tx.update(docVersao, {
          verificacao: { status, pendencias, verificadaEm: agora, modeloRevisor },
          ...(ia ? { 'uso.revisor': custo, 'uso.usdEstimado': FieldValue.increment(custo.usdEstimado) } : {}),
        });
        const aindaFecha = fecha && atual.estado === 'sintetizando' && atual.analiseAtual === versao;
        // The confidence follows the current version only.
        tx.update(ref, {
          ...(atual.analiseAtual === versao ? lead : {}),
          ...(aindaFecha ? { estado, estadoEm: agora } : {}),
          ...(ia ? {
            'custo.tokensEntrada': FieldValue.increment(custo.tokensEntrada),
            'custo.tokensSaida': FieldValue.increment(custo.tokensSaida),
            'custo.usdEstimado': FieldValue.increment(custo.usdEstimado),
          } : {}),
        });
        tx.create(ref.collection('eventos').doc(), {
          em: agora, ator: { tipo: ia ? 'ia' : 'sistema', id: 'verificar' }, tipo: 'verificacao',
          detalhe: { versao, status, pendencias: pendencias.length, porTipo: contaPorTipo(pendencias), revisor: ia, confianca: lead['lead.modificadores.confianca'] },
        });
        if (ia) {
          tx.set(
            db.collection('metricas').doc(mesDe((f.recebidaEm as Timestamp).toDate())),
            { custo: { verificacao: { usdEstimado: FieldValue.increment(custo.usdEstimado), tokensEntrada: FieldValue.increment(custo.tokensEntrada), tokensSaida: FieldValue.increment(custo.tokensSaida) } }, atualizadoEm: agora },
            { merge: true },
          );
        }
      });

      if (fecha) {
        const g = (await ref.get()).data();
        if (g?.estado === estado && g.analiseAtual === versao) {
          const l = g.lead;
          const base = URL_BASE_POR_PROJETO[projeto()];
          await avisoAnalise(noEmulador() ? '' : SMTP2GO_API_KEY.value(), {
            fichaId: id, empresa: g.original?.empresa ?? '', versao, pronta: status === 'pronta', pendencias: pendencias.length,
            quadrante: rotuloQuadrante(l.quadrante), destino: rotuloDestino(l.destino), grau: l.grau, pontos: l.pontos,
            confianca: l.modificadores?.confianca, confiancaMotivo: l.modificadores?.confiancaMotivo ?? '',
            prazoEm: l.acao?.prazoEm ? (l.acao.prazoEm as Timestamp).toDate() : null,
            portaProvavel: a.enquadramento?.portaProvavel ?? '–', resumoExecutivo: a.resumoExecutivo ?? '',
            link: base ? `${base}/admin/leads/${id}` : `fichas/${id}`,
          }).catch(async (e) => {
            const mensagem = String((e as Error)?.message ?? e).slice(0, 300);
            logger.error('verificar: e-mail failed', { id, mensagem });
            await ref.update({ erro: { etapa: 'verificar.email', mensagem, em: Timestamp.now() } }).catch(() => undefined);
          });
        }
      }
      logger.info('verificar: done', { id, versao, status, pendencias: pendencias.length, revisor: ia });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('verificar failed', { id, versao, mensagem });
      await ref.update({ erro: { etapa: 'verificar', mensagem, em: Timestamp.now() } }).catch(() => undefined);
    }
  },
);

const contaPorTipo = (ps: Pendencia[]) => ps.reduce<Record<string, number>>((t, x) => ({ ...t, [x.tipo]: (t[x.tipo] ?? 0) + 1 }), {});
