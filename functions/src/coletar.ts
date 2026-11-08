// coletar – runs when a ficha moves to "coletando" (spec 01, sections 2 to 4; spec 02, sections 2 and 5;
// spec 03). Two cases:
// - first pass (none of the four remaining stages exists yet): empresa_pessoas and empresa_noticias in
//   parallel, with Apify completing the Instagram of empresa_digital; then setor, which reads the coleta
//   mínima; then mercado. Search budget: what the coleta mínima left of the single ceiling.
// - re-run (a script or, later, the module set some stage documents to "pendente"): only those stages,
//   empresa_digital and empresa_registro included, each after the stages it reads; budget of its own,
//   the sum of the maxima of those stages, limited by the ceiling.
// Then the ficha moves to "coletada". versaoMetodo is the one recorded at the start of the coleta mínima.
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { APIFY_TOKEN, APOLLO_API_KEY, CLAUDE_API_KEY, HUNTER_API_KEY, REGIAO } from './config.js';
import { lePipeline } from './pipeline.js';
import { lePrecos } from './precos.js';
import { modeloDe } from './modelos.js';
import { noEmulador } from './claude.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import { dominioDe, sinaisIniciais } from './qualificacao.js';
import { ETAPAS, ETAPAS_RESTANTES, orcamentoBuscas, orcamentoPrimeiraPassagem, type Etapa } from './coleta/etapas.js';
import { completaInstagram, roda, type Contexto } from './coleta/motor.js';
import { mesDe } from './qualificar.js';
import type { Normalizado, Original } from './validacao.js';


export const coletar = onDocumentUpdated(
  {
    document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY, APOLLO_API_KEY, APIFY_TOKEN, HUNTER_API_KEY],
    memory: '1GiB', timeoutSeconds: 540, maxInstances: 3, retry: false,
  },
  async (evento) => {
    const antes = evento.data?.before.data();
    const depois = evento.data?.after.data();
    if (!depois || depois.estado !== 'coletando' || antes?.estado === 'coletando') return;
    const id = evento.params.id;
    const db = getFirestore();
    const ref = db.collection('fichas').doc(id);
    try {
      const p = await lePipeline();
      const versao = (depois.versaoMetodo as string | undefined) ?? ((await db.doc('config/metodo').get()).get('versao') as string | undefined);
      if (!versao) throw new Error('ficha and config/metodo have no method version');
      if (!noEmulador() && !modeloDe(p, 'coleta')) throw new Error('config/pipeline.modelos.coleta is empty');

      // Claim: the transaction gives up if another delivery of the event got here first.
      const agora = Timestamp.now();
      let ficou = false;
      let aRodar: Etapa[] = [];
      let primeira = false;
      let buscasMinima = 0;
      await db.runTransaction(async (tx) => {
        aRodar = [];
        const f = (await tx.get(ref)).data();
        const docs = await Promise.all(ETAPAS.map((e) => tx.get(ref.collection('coleta').doc(e))));
        if (!f || f.estado !== 'coletando' || !(f.estadoEm as Timestamp).isEqual(depois.estadoEm as Timestamp)) return;
        ficou = true;
        const porEtapa = Object.fromEntries(ETAPAS.map((e, i) => [e, docs[i]]));
        primeira = ETAPAS_RESTANTES.every((e) => !porEtapa[e].exists);
        if (primeira) {
          aRodar = [...ETAPAS_RESTANTES];
          buscasMinima = ['empresa_digital', 'empresa_registro'].reduce((t, e) => t + Number(porEtapa[e].get('uso.buscas') ?? 0), 0);
        } else {
          // Re-run: exactly the stages marked "pendente" by whoever asked for it.
          aRodar = ETAPAS.filter((e) => porEtapa[e].get('status') === 'pendente');
        }
        tx.update(ref, { estadoEm: agora });
        for (const e of aRodar) {
          const v = porEtapa[e].data();
          tx.set(porEtapa[e].ref, { etapa: e, status: 'pendente', versaoMetodo: versao, tentativa: v?.tentativa ?? 0, ...(v?.insumosCodigo ? { insumosCodigo: v.insumosCodigo } : {}) });
        }
        tx.create(ref.collection('eventos').doc(), {
          em: agora, ator: { tipo: 'sistema', id: 'coletar' }, tipo: 'coleta_iniciada', detalhe: { versaoMetodo: versao, passagem: primeira ? 'primeira' : 'reexecucao', etapas: aRodar },
        });
      });
      if (!ficou) return;

      const original = depois.original as Original;
      const normalizado = depois.normalizado as Normalizado;
      const s = depois.qualificacao?.siteResolvido !== undefined
        ? { dominioCorporativo: depois.qualificacao.dominioCorporativo === true, siteResolvido: depois.qualificacao.siteResolvido ?? null }
        : sinaisIniciais(normalizado);
      const c: Contexto = {
        id, ref, p, versao,
        email: normalizado.email,
        sinais: s,
        contexto: { rotulo: 'qualificacao', valor: depois.qualificacao ?? {} },
        ficha: {
          nome: original.nome, empresa: original.empresa, cargo: original.cargo, rotuloCargo: CARGOS_ROTULO[original.cargo] ?? original.cargo,
          dominioEmail: dominioDe(normalizado.email), site: normalizado.site, mensagem: original.mensagem, lang: original.lang,
        },
        chaves: noEmulador()
          ? { claude: '', apollo: '', apify: '', hunter: '' }
          : { claude: CLAUDE_API_KEY.value(), apollo: APOLLO_API_KEY.value(), apify: APIFY_TOKEN.value(), hunter: HUNTER_API_KEY.value() },
        apify: true,
        aRodar: new Set(aRodar),
        buscasRestantes: primeira ? orcamentoPrimeiraPassagem(p.tetoBuscasPorFicha, buscasMinima) : orcamentoBuscas(p.tetoBuscasPorFicha, aRodar),
        chamadas: { brasilapi: 0, apollo: 0, apify: 0, hunter: 0 },
        conteudos: {},
        codigo: {},
        site: null,
        precos: await lePrecos(),
        totais: { tokensEntrada: 0, tokensSaida: 0, buscas: 0, usd: 0 },
      };

      // Stages not in aRodar are only read; the order respects what each stage reads.
      const digital = roda(c, 'empresa_digital').then(() => (primeira ? completaInstagram(c) : undefined));
      const pessoas = roda(c, 'empresa_pessoas');
      const noticias = roda(c, 'empresa_noticias');
      const registro = digital.then(() => roda(c, 'empresa_registro'));
      const setor = registro.then(() => roda(c, 'setor'));
      const mercado = setor.then(() => roda(c, 'mercado'));
      await Promise.allSettled([digital, pessoas, noticias, registro, setor, mercado]);

      const fim = Timestamp.now();
      const t = c.totais;
      const usd = Math.round(t.usd * 1e6) / 1e6;
      await db.runTransaction(async (tx) => {
        const f = (await tx.get(ref)).data();
        if (f?.estado !== 'coletando') return;
        tx.update(ref, {
          estado: 'coletada',
          estadoEm: fim,
          'custo.tokensEntrada': FieldValue.increment(t.tokensEntrada),
          'custo.tokensSaida': FieldValue.increment(t.tokensSaida),
          'custo.buscas': FieldValue.increment(t.buscas),
          'custo.usdEstimado': FieldValue.increment(usd),
        });
        tx.set(
          db.collection('metricas').doc(mesDe((depois.recebidaEm as Timestamp).toDate())),
          { custo: { coleta: { fichas: FieldValue.increment(1), usdEstimado: FieldValue.increment(usd), tokensEntrada: FieldValue.increment(t.tokensEntrada), tokensSaida: FieldValue.increment(t.tokensSaida), buscas: FieldValue.increment(t.buscas) } }, atualizadoEm: fim },
          { merge: true },
        );
      });
      logger.info('coletar: done', { id, passagem: primeira ? 'primeira' : 'reexecucao', etapas: aRodar, buscas: t.buscas, usd });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('coletar failed', { id, mensagem });
      await ref.update({ erro: { etapa: 'coletar', mensagem, em: Timestamp.now() } }).catch(() => undefined);
    }
  },
);
