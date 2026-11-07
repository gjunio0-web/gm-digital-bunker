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
import { chamaClaude, noEmulador, type Resposta } from './claude.js';
import { custoDe, type Uso } from './custo.js';
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

const TIMEOUT_CHAMADA_MS = 300_000;

export const sintetizar = onDocumentUpdated(
  { document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY], memory: '1GiB', timeoutSeconds: 540, maxInstances: 3, retry: false },
  async (evento) => {
    const antes = evento.data?.before.data();
    const depois = evento.data?.after.data();
    if (!depois || depois.estado !== 'coletada' || antes?.estado === 'coletada') return;
    const id = evento.params.id;
    const db = getFirestore();
    const ref = db.collection('fichas').doc(id);
    const usos: Record<string, Uso> = {};
    let modelo = '';
    try {
      const p = await lePipeline();
      if (!noEmulador() && !p.modeloSintese) throw new Error('config/pipeline.modeloSintese is empty');

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
      modelo = noEmulador() ? 'simulado' : p.modeloSintese;
      // The five method files, whole (spec 02, 3).
      const metodo = await leMetodo({ 'glossario.md': 'tudo', 'escopo-limites.md': 'tudo', 'portas-materiais.md': 'tudo', 'mapa-alavancas.md': 'tudo', 'livro-selecao.md': 'tudo' });
      const blocos = metodo.blocos.map((b) => ({ nome: b.nome, texto: b.texto }));
      const chama = async (nome: string, usuario: { texto: string; cache?: boolean }[], esquema: object, maxTokens: number, simulado: () => unknown): Promise<unknown> => {
        if (noEmulador()) return simulado();
        const r: Resposta = await chamaClaude({ chave: CLAUDE_API_KEY.value(), modelo, metodo: blocos, usuario, esquema, maxTokens, timeoutMs: TIMEOUT_CHAMADA_MS });
        usos[nome] = r.uso;
        return r.json;
      };

      const enq = validaEnquadrar(await chama('enquadrar', mensagemEnquadrar(dados), ESQUEMA_ENQUADRAR, 16_000, simulaEnquadrar));
      const anteriores = await ref.collection('analise').get();
      const versao = `v${anteriores.size + 1}`;
      const lead = await graduaAnalise(ref, p, enq, versao);
      const conversa = validaConversa(await chama('preparar_conversa', mensagemConversa(dados, enq, lead), ESQUEMA_CONVERSA, 16_000, simulaConversa));
      const comFalha = /pend[eê]ncia/i.test(original.mensagem ?? '');
      const montagem = validaMontar(await chama('montar_analise', mensagemMontar(dados, enq, conversa), ESQUEMA_MONTAR, 32_000, () => simulaMontar(comFalha)));

      // Cost of the three calls, per call and in total.
      const porChamada = Object.fromEntries(Object.entries(usos).map(([k, u]) => [k, custoDe(modelo, u)]));
      const total = Object.values(porChamada).reduce(
        (t, k) => ({ tokensEntrada: t.tokensEntrada + k.tokensEntrada, tokensSaida: t.tokensSaida + k.tokensSaida, usd: t.usd + (k.usdEstimado ?? 0) }),
        { tokensEntrada: 0, tokensSaida: 0, usd: 0 },
      );
      const usd = Math.round(total.usd * 1e6) / 1e6;

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
          uso: { tokensEntrada: total.tokensEntrada, tokensSaida: total.tokensSaida, usdEstimado: usd, chamadas: porChamada },
          criadaEm,
        });
        tx.update(ref, {
          analiseAtual: versao,
          'custo.tokensEntrada': FieldValue.increment(total.tokensEntrada),
          'custo.tokensSaida': FieldValue.increment(total.tokensSaida),
          'custo.usdEstimado': FieldValue.increment(usd),
        });
        tx.create(ref.collection('eventos').doc(), { em: criadaEm, ator: { tipo: 'ia', id: 'sintetizar' }, tipo: 'sintese', detalhe: { versao, modelo, usdEstimado: usd } });
        tx.set(
          db.collection('metricas').doc(mesDe((depois.recebidaEm as Timestamp).toDate())),
          { custo: { sintese: { versoes: FieldValue.increment(1), usdEstimado: FieldValue.increment(usd), tokensEntrada: FieldValue.increment(total.tokensEntrada), tokensSaida: FieldValue.increment(total.tokensSaida) } }, atualizadoEm: criadaEm },
          { merge: true },
        );
      });
      logger.info('sintetizar: done', { id, versao, usd });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('sintetizar failed', { id, mensagem });
      // Calls already made are paid for: their cost goes to the ficha even when the synthesis fails.
      const ks = Object.values(usos).map((u) => custoDe(modelo, u));
      const custo = ks.length
        ? {
            'custo.tokensEntrada': FieldValue.increment(ks.reduce((t, k) => t + k.tokensEntrada, 0)),
            'custo.tokensSaida': FieldValue.increment(ks.reduce((t, k) => t + k.tokensSaida, 0)),
            'custo.usdEstimado': FieldValue.increment(Math.round(ks.reduce((t, k) => t + (k.usdEstimado ?? 0), 0) * 1e6) / 1e6),
          }
        : {};
      await ref.update({ erro: { etapa: 'sintetizar', mensagem, em: Timestamp.now() }, ...custo }).catch(() => undefined);
    }
  },
);
