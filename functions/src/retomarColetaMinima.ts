// retomarColetaMinima – runs when acaoAdmin clears erro of a ficha that stopped in the coleta mínima and has a minimal
// stage marked "pendente" (spec 01 v0.32, 4.1, item 3, alvos empresa_digital and empresa_registro in coleta_minima):
// it runs the pending minimal stages (empresa_digital without Apify, empresa_registro) and then qualificar and graduar,
// as in the first pass. The previous data of a re-run stage is kept and preserved on failure like in coletar
// (spec 03, 7.3). retomarTriagem does the opposite case: no stage pending, only the triagem missing. The claim is a
// transaction on estadoEm, so a second delivery of the event does nothing.
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { APOLLO_API_KEY, CLAUDE_API_KEY, REGIAO, SMTP2GO_API_KEY } from './config.js';
import { lePipeline } from './pipeline.js';
import { lePrecos } from './precos.js';
import { modeloDe } from './modelos.js';
import { noEmulador } from './claude.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import { dominioDe, sinaisIniciais } from './qualificacao.js';
import { ETAPAS_MINIMAS, orcamentoBuscas, type Etapa } from './coleta/etapas.js';
import { roda, type Contexto, type DocAnterior } from './coleta/motor.js';
import { anteriorDe } from './coleta/preservacao.js';
import { mesDe } from './qualificar.js';
import { concluiTriagem } from './triagem.js';
import { gravaErro } from './erroTriagem.js';
import type { Normalizado, Original } from './validacao.js';

type Ficha = { estado?: string; erro?: unknown } | undefined;

// Pure part of the trigger: erro went from filled to null while the ficha is in coleta_minima. Whether a minimal
// stage is pending is read from the stage documents (it decides between this function and retomarTriagem).
export function deveRetomarColeta(antes: Ficha, depois: Ficha): boolean {
  return Boolean(antes?.erro) && Boolean(depois) && !depois?.erro && depois?.estado === 'coleta_minima';
}

export const retomarColetaMinima = onDocumentUpdated(
  { document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY, APOLLO_API_KEY, SMTP2GO_API_KEY], memory: '1GiB', timeoutSeconds: 540, maxInstances: 3, retry: false },
  async (evento) => {
    const depois = evento.data?.after.data();
    if (!depois || !deveRetomarColeta(evento.data?.before.data(), depois)) return;
    const id = evento.params.id;
    const db = getFirestore();
    const ref = db.collection('fichas').doc(id);
    let etapa = 'coleta_minima';
    try {
      const p = await lePipeline();
      const versao = (depois.versaoMetodo as string | undefined) ?? ((await db.doc('config/metodo').get()).get('versao') as string | undefined);
      if (!versao) throw new Error('ficha and config/metodo have no method version');
      if (!noEmulador() && !modeloDe(p, 'coleta')) throw new Error('config/pipeline.modelos.coleta is empty');

      // Claim: the minimal stages marked pendente; a stage with previous content only changes status (its data stays
      // in the document and in memory), any other is written afresh. Gives up when none is pending (retomarTriagem's case).
      const agora = Timestamp.now();
      let ficou = false;
      let aRodar: Etapa[] = [];
      let anterior: Partial<Record<Etapa, DocAnterior>> = {};
      await db.runTransaction(async (tx) => {
        aRodar = [];
        anterior = {};
        const f = (await tx.get(ref)).data();
        const docs = await Promise.all(ETAPAS_MINIMAS.map((e) => tx.get(ref.collection('coleta').doc(e))));
        if (!f || f.estado !== 'coleta_minima' || !(f.estadoEm as Timestamp).isEqual(depois.estadoEm as Timestamp)) return;
        aRodar = ETAPAS_MINIMAS.filter((_, i) => docs[i].get('status') === 'pendente');
        if (!aRodar.length) return;
        ficou = true;
        tx.update(ref, { estadoEm: agora });
        for (const e of aRodar) {
          const d = docs[ETAPAS_MINIMAS.indexOf(e)];
          const v = d.data();
          const ant = anteriorDe(v);
          if (ant) {
            anterior[e] = ant;
            tx.update(d.ref, { status: 'pendente', versaoMetodo: versao });
          } else tx.set(d.ref, { etapa: e, status: 'pendente', versaoMetodo: versao, tentativa: v?.tentativa ?? 0, ...(v?.insumosCodigo ? { insumosCodigo: v.insumosCodigo } : {}) });
        }
      });
      if (!ficou) return;

      const original = depois.original as Original;
      const normalizado = depois.normalizado as Normalizado;
      const s = depois.qualificacao?.siteResolvido !== undefined
        ? { dominioCorporativo: depois.qualificacao.dominioCorporativo === true, siteResolvido: depois.qualificacao.siteResolvido ?? null }
        : sinaisIniciais(normalizado);
      const claude = noEmulador() ? '' : CLAUDE_API_KEY.value();
      const c: Contexto = {
        id, ref, p, versao,
        email: normalizado.email,
        sinais: s,
        contexto: { rotulo: 'sinais', valor: s },
        ficha: {
          nome: original.nome, empresa: original.empresa, cargo: original.cargo, rotuloCargo: CARGOS_ROTULO[original.cargo] ?? original.cargo,
          dominioEmail: dominioDe(normalizado.email), site: normalizado.site, mensagem: original.mensagem, lang: original.lang,
        },
        chaves: { claude, apollo: noEmulador() ? '' : APOLLO_API_KEY.value(), apify: '', hunter: '' },
        apify: false,
        aRodar: new Set(aRodar),
        anterior,
        // Budget of its own: the minimal stages that run now, limited by the ceiling (as in the first pass).
        buscasRestantes: orcamentoBuscas(p.tetoBuscasPorFicha, aRodar),
        chamadas: { brasilapi: 0, apollo: 0, apify: 0, hunter: 0 },
        conteudos: {},
        codigo: {},
        site: null,
        precos: await lePrecos(),
        totais: { tokensEntrada: 0, tokensSaida: 0, buscas: 0, usd: 0 },
      };
      await roda(c, 'empresa_digital');
      await roda(c, 'empresa_registro');

      const t = c.totais;
      const usd = Math.round(t.usd * 1e6) / 1e6;
      const fim = Timestamp.now();
      const status = Object.fromEntries(
        await Promise.all(ETAPAS_MINIMAS.map(async (e) => [e, (await ref.collection('coleta').doc(e).get()).get('status')])),
      );
      const lote = db.batch();
      lote.update(ref, {
        'custo.tokensEntrada': FieldValue.increment(t.tokensEntrada),
        'custo.tokensSaida': FieldValue.increment(t.tokensSaida),
        'custo.buscas': FieldValue.increment(t.buscas),
        'custo.usdEstimado': FieldValue.increment(usd),
      });
      lote.create(ref.collection('eventos').doc(), { em: fim, ator: { tipo: 'sistema', id: 'retomarColetaMinima' }, tipo: 'coleta_minima', detalhe: { versaoMetodo: versao, etapas: status, buscas: t.buscas, passagem: 'reexecucao' } });
      // The ficha was already counted by the first pass: only the cost of this run is added to the month.
      lote.set(
        db.collection('metricas').doc(mesDe((depois.recebidaEm as Timestamp).toDate())),
        { custo: { coletaMinima: { usdEstimado: FieldValue.increment(usd), buscas: FieldValue.increment(t.buscas) } }, atualizadoEm: fim },
        { merge: true },
      );
      await lote.commit();

      const { decisao, g } = await concluiTriagem(ref, id, p, { claude, smtp: noEmulador() ? '' : SMTP2GO_API_KEY.value() }, true, (e) => { etapa = e; });
      logger.info('retomarColetaMinima: done', { id, etapas: aRodar, buscas: t.buscas, usd, decisao, quadrante: g?.lead.quadrante, grau: g?.lead.grau, estado: g?.estado });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('retomarColetaMinima failed', { id, etapa, mensagem });
      await gravaErro(ref, etapa, mensagem);
    }
  },
);
