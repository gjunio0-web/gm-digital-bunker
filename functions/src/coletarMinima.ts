// coletarMinima – runs when a ficha is created (spec 01, sections 3 and 4; spec 02, sections 1 and 2;
// spec 04, section 1). Computes dominioCorporativo and siteResolvido, records versaoMetodo, runs
// empresa_digital (without Apify) and then empresa_registro, and in the same invocation calls qualificar
// and graduar (triagem). Every ficha goes through it, spam included. The claim is a transaction on the
// "recebida" state, so a second delivery of the event does nothing.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { APOLLO_API_KEY, CLAUDE_API_KEY, REGIAO } from './config.js';
import { lePipeline } from './pipeline.js';
import { lePrecos } from './precos.js';
import { modeloDe } from './modelos.js';
import { noEmulador } from './claude.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import { dominioDe, sinaisIniciais } from './qualificacao.js';
import { ETAPAS_MINIMAS, orcamentoBuscas } from './coleta/etapas.js';
import { roda, type Contexto } from './coleta/motor.js';
import { mesDe, qualifica } from './qualificar.js';
import { graduaTriagem } from './graduar.js';
import type { Normalizado, Original } from './validacao.js';

export const coletarMinima = onDocumentCreated(
  { document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY, APOLLO_API_KEY], memory: '1GiB', timeoutSeconds: 540, maxInstances: 5, retry: false },
  async (evento) => {
    const id = evento.params.id;
    const db = getFirestore();
    const ref = db.collection('fichas').doc(id);
    let etapa = 'coleta_minima';
    try {
      const f = (await ref.get()).data();
      if (!f || f.estado !== 'recebida') return;
      const p = await lePipeline();
      const versao = (await db.doc('config/metodo').get()).get('versao') as string | undefined;
      if (!versao) throw new Error('config/metodo has no published version');
      if (!noEmulador() && !modeloDe(p, 'coleta')) throw new Error('config/pipeline.modelos.coleta is empty');
      const original = f.original as Original;
      const normalizado = f.normalizado as Normalizado;
      const s = sinaisIniciais(normalizado);

      // Claim: state recebida → coleta_minima, versaoMetodo, the two signals and the two stage documents.
      const agora = Timestamp.now();
      let ficou = false;
      await db.runTransaction(async (tx) => {
        const atual = (await tx.get(ref)).data();
        if (!atual || atual.estado !== 'recebida' || !(atual.estadoEm as Timestamp).isEqual(f.estadoEm as Timestamp)) return;
        ficou = true;
        tx.update(ref, { estado: 'coleta_minima', estadoEm: agora, versaoMetodo: versao, qualificacao: { ...s } });
        for (const e of ETAPAS_MINIMAS) tx.set(ref.collection('coleta').doc(e), { etapa: e, status: 'pendente', versaoMetodo: versao, tentativa: 0 });
      });
      if (!ficou) return;

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
        aRodar: new Set(ETAPAS_MINIMAS),
        // First pass: the coleta mínima takes what its stages can use from the single ceiling of 20;
        // the remaining stages get what is left (spec 01, config/pipeline).
        buscasRestantes: orcamentoBuscas(p.tetoBuscasPorFicha, ETAPAS_MINIMAS),
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
      lote.create(ref.collection('eventos').doc(), { em: fim, ator: { tipo: 'sistema', id: 'coletarMinima' }, tipo: 'coleta_minima', detalhe: { versaoMetodo: versao, etapas: status, buscas: t.buscas } });
      lote.set(
        db.collection('metricas').doc(mesDe((f.recebidaEm as Timestamp).toDate())),
        { custo: { coletaMinima: { fichas: FieldValue.increment(1), usdEstimado: FieldValue.increment(usd), buscas: FieldValue.increment(t.buscas) } }, atualizadoEm: fim },
        { merge: true },
      );
      await lote.commit();

      etapa = 'qualificar';
      const decisao = await qualifica(ref, p, claude);
      etapa = 'graduar';
      const g = await graduaTriagem(ref, p);
      logger.info('coletarMinima: done', { id, buscas: t.buscas, usd, decisao, quadrante: g?.lead.quadrante, grau: g?.lead.grau, estado: g?.estado });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('coletarMinima failed', { id, etapa, mensagem });
      await ref.update({ erro: { etapa, mensagem, em: Timestamp.now() } }).catch(() => undefined);
    }
  },
);
