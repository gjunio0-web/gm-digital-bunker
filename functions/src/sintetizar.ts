// sintetizar – runs when a ficha moves to "coletada" (spec 01, sections 3 and 4; spec 02, section 3):
// claims the ficha ("sintetizando"), then enquadrar → graduar (analysis moment) → preparar_conversa, with
// lead.destino and lead.modificadores in <lead> → montar_analise; writes analise/vN (s0 and s8 made by the
// code, source marks turned into links) and analiseAtual. The ficha stays in "sintetizando": verificar
// runs on the creation of analise/vN and sets the final state. On failure the ficha keeps "sintetizando"
// with erro filled (going back to "coletada" would start the synthesis again by itself); a re-run is
// asked by moving it to "coletada" again (scripts/fichas-teste.mjs --sintese).
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { CLAUDE_API_KEY, REGIAO } from './config.js';
import { lePipeline } from './pipeline.js';
import { chamaClaude, ErroComUso, noEmulador, type Resposta } from './claude.js';
import { lePrecos } from './precos.js';
import { chaveDesenho, esforcoApi, esforcoDe, modeloDe } from './modelos.js';
import { promptDe, totalDe, usoChamada, type UsoChamada } from './uso.js';
import { leMetodo } from './metodo.js';
import { graduaAnalise } from './graduar.js';
import { dominioDe } from './qualificacao.js';
import { mesDe } from './qualificar.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import {
  ESQUEMA_CONVERSA, ESQUEMA_ENQUADRAR, ESQUEMA_MONTAR, ETAPAS_COLETA, SECOES_MODELO, blocoDados, coletaDe, enquadramentoGravado,
  linkaMarcas, mensagemConversa, mensagemEnquadrar, mensagemMontar, secaoS0, secaoS8, simulaConversa, simulaEnquadrar, simulaMontar,
  validaConversa, validaEnquadrar, validaMontar, type FichaSintese,
} from './sintese.js';
import type { Normalizado, Original } from './validacao.js';

// Output budgets (thinking included; Sonnet 5.5 allows 128K) and wait per call, authorized by Gon on
// 7/11/2026 after enquadrar hit 16,000 tokens in two test fichas.
const MAX_TOKENS = { enquadrar: 32_000, preparar_conversa: 32_000, montar_analise: 48_000 } as const;
const TIMEOUT_CHAMADA_MS = 480_000;

export const sintetizar = onDocumentUpdated(
  { document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY], memory: '1GiB', timeoutSeconds: 540, maxInstances: 3, retry: false },
  async (evento) => {
    const antes = evento.data?.before.data();
    const depois = evento.data?.after.data();
    if (!depois || depois.estado !== 'coletada' || antes?.estado === 'coletada') return;
    const id = evento.params.id;
    const db = getFirestore();
    const ref = db.collection('fichas').doc(id);
    // Usage of each call made, kept even when a later call fails (a billed call is paid for).
    const registros: Record<string, UsoChamada> = {};
    try {
      const p = await lePipeline();
      const precos = await lePrecos();
      const ETAPAS_SINTESE = ['enquadrar', 'preparar_conversa', 'montar_analise'] as const;
      const modelos = Object.fromEntries(ETAPAS_SINTESE.map((e) => [e, noEmulador() ? 'simulado' : modeloDe(p, e)])) as Record<(typeof ETAPAS_SINTESE)[number], string>;
      const vazio = ETAPAS_SINTESE.find((e) => !modelos[e]);
      if (vazio) throw new Error(`config/pipeline.modelos.${vazio} is empty`);

      // Claim: the transaction gives up if another delivery of the event got here first.
      let ficou = false;
      await db.runTransaction(async (tx) => {
        const f = (await tx.get(ref)).data();
        if (!f || f.estado !== 'coletada' || !(f.estadoEm as Timestamp).isEqual(depois.estadoEm as Timestamp)) return;
        ficou = true;
        tx.update(ref, { estado: 'sintetizando', estadoEm: Timestamp.now(), erro: null });
      });
      if (!ficou) return;

      const original = depois.original as Original;
      const normalizado = depois.normalizado as Normalizado;
      const snaps = await Promise.all(ETAPAS_COLETA.map((e) => ref.collection('coleta').doc(e).get()));
      const coleta = coletaDe(Object.fromEntries(ETAPAS_COLETA.map((e, i) => [e, snaps[i].data()])));
      const rotuloCargo = CARGOS_ROTULO[original.cargo] ?? original.cargo;
      const ficha: FichaSintese = {
        nome: original.nome, empresa: original.empresa, cargo: original.cargo, rotuloCargo, dominioEmail: dominioDe(normalizado.email),
        site: normalizado.site, mensagem: original.mensagem, pagina: depois.origem?.pagina ?? null, lang: original.lang,
      };
      const dados = blocoDados(ficha, depois.qualificacao ?? null, coleta);
      const modelo = modelos.montar_analise;
      // The five method files, whole (spec 02, 3).
      const metodo = await leMetodo({ 'glossario.md': 'tudo', 'escopo-limites.md': 'tudo', 'portas-materiais.md': 'tudo', 'mapa-alavancas.md': 'tudo', 'livro-selecao.md': 'tudo' });
      const blocos = metodo.blocos.map((b) => ({ nome: b.nome, texto: b.texto }));
      // Each call with the model and effort of its stage (config/pipeline). A failed call names itself in
      // the error and, when it was billed, still counts in the cost.
      const chama = async (nome: (typeof ETAPAS_SINTESE)[number], usuario: { texto: string; cache?: boolean }[], esquema: object, simulado: () => unknown): Promise<unknown> => {
        const esforco = esforcoDe(p, nome);
        if (noEmulador()) {
          registros[nome] = usoChamada(precos, modelos[nome], esforco, null, 0);
          return simulado();
        }
        let r: Resposta | null = null;
        const inicio = Date.now();
        try {
          r = await chamaClaude({ chave: CLAUDE_API_KEY.value(), modelo: modelos[nome], metodo: blocos, usuario, esquema, maxTokens: MAX_TOKENS[nome], timeoutMs: TIMEOUT_CHAMADA_MS, esforco: esforcoApi(esforco) });
          return r.json;
        } catch (e) {
          if (e instanceof ErroComUso) registros[nome] = usoChamada(precos, modelos[nome], esforco, e.uso, Date.now() - inicio);
          throw new Error(`${nome}: ${String((e as Error)?.message ?? e)}`);
        } finally {
          if (r) registros[nome] = usoChamada(precos, modelos[nome], esforco, r.uso, Date.now() - inicio);
        }
      };

      const enq = validaEnquadrar(await chama('enquadrar', mensagemEnquadrar(dados), ESQUEMA_ENQUADRAR, simulaEnquadrar));
      const anteriores = await ref.collection('analise').get();
      const versao = `v${anteriores.size + 1}`;
      const lead = await graduaAnalise(ref, p, enq, versao);
      const conversa = validaConversa(await chama('preparar_conversa', mensagemConversa(dados, enq, lead), ESQUEMA_CONVERSA, simulaConversa));
      const comFalha = /pend[eê]ncia/i.test(original.mensagem ?? '');
      const montagem = validaMontar(await chama('montar_analise', mensagemMontar(dados, enq, conversa), ESQUEMA_MONTAR, () => simulaMontar(comFalha)));

      // Usage per call and in total (spec 01 v0.11, uso); the revisor's entry is added by verificar.
      const chamadas = Object.values(registros);
      const total = totalDe(chamadas);
      const usd = total.usdEstimado;
      const desenho = chaveDesenho(registros);

      const criadaEm = Timestamp.now();
      const secoes: Record<string, unknown> = {
        s0: secaoS0({ empresa: original.empresa, rotuloCargo, recebidaEm: (depois.recebidaEm as Timestamp).toDate(), criadaEm: criadaEm.toDate(), versao, lead, versaoMetodo: metodo.versao, modelo }),
        ...Object.fromEntries(SECOES_MODELO.map((s) => [s, { ...montagem[s], corpo: linkaMarcas(montagem[s].corpo, coleta) }])),
        s8: secaoS8(coleta),
      };

      await db.runTransaction(async (tx) => {
        const f = (await tx.get(ref)).data();
        const doc = ref.collection('analise').doc(versao);
        if (!f || f.estado !== 'sintetizando' || (await tx.get(doc)).exists) throw new Error('sintetizar: ficha changed meanwhile');
        tx.create(doc, {
          autor: { tipo: 'ia', id: modelo },
          baseadaEm: f.analiseAtual ?? null,
          versaoMetodo: metodo.versao,
          secoes,
          enquadramento: enquadramentoGravado(enq),
          resumoExecutivo: montagem.resumoExecutivo,
          conversa: { perguntas: conversa.perguntas, materiais: conversa.materiais, pontosDeAtencao: conversa.pontosDeAtencaoParaOConsultor },
          rascunhoResposta: conversa.rascunhoResposta,
          uso: { ...registros, total },
          criadaEm,
        });
        tx.update(ref, {
          analiseAtual: versao,
          'custo.tokensEntrada': FieldValue.increment(promptDe(chamadas)),
          'custo.tokensSaida': FieldValue.increment(total.tokensSaida),
          'custo.usdEstimado': FieldValue.increment(usd),
        });
        tx.create(ref.collection('eventos').doc(), { em: criadaEm, ator: { tipo: 'ia', id: 'sintetizar' }, tipo: 'sintese', detalhe: { versao, desenho, usdEstimado: usd } });
        // metricas: the synthesis cost as before, and the comparison by design (spec 01 v0.11, metricas).
        tx.set(
          db.collection('metricas').doc(mesDe((depois.recebidaEm as Timestamp).toDate())),
          {
            custo: { sintese: { versoes: FieldValue.increment(1), usdEstimado: FieldValue.increment(usd), tokensEntrada: FieldValue.increment(promptDe(chamadas)), tokensSaida: FieldValue.increment(total.tokensSaida) } },
            sintesePorDesenho: { [desenho]: { versoes: FieldValue.increment(1), somaPontos: FieldValue.increment(lead.pontos), usdEstimado: FieldValue.increment(usd), usdSemCache: FieldValue.increment(total.usdSemCache) } },
            atualizadoEm: criadaEm,
          },
          { merge: true },
        );
      });
      logger.info('sintetizar: done', { id, versao, usd });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('sintetizar failed', { id, mensagem });
      // Calls already made are paid for: their cost goes to the ficha even when the synthesis fails.
      const ks = Object.values(registros);
      const t = totalDe(ks);
      const custo = ks.length
        ? {
            'custo.tokensEntrada': FieldValue.increment(promptDe(ks)),
            'custo.tokensSaida': FieldValue.increment(t.tokensSaida),
            'custo.usdEstimado': FieldValue.increment(t.usdEstimado),
          }
        : {};
      await ref.update({ erro: { etapa: 'sintetizar', mensagem, em: Timestamp.now() }, ...custo }).catch(() => undefined);
    }
  },
);
