// verificar – runs on the creation of fichas/{id}/analise/{versao} (decision of Gon, 7/11/2026, to be
// recorded in spec 01 v0.10 and spec 02 v0.11): the code checks of spec 02, 4.1 always; for an AI version,
// first the repair of spec 02 v0.12, 3.4 (one call per stage with failures, then the checks again) and the
// reviewer of 4.2 on the repaired text (autor.tipo = ia). Writes verificacao in the version; not done
// again when the version already has it. For an AI version: graduar recalculates only the confidence (spec 04,
// 2.5) and, for the current analysis of a ficha in "sintetizando", the final state analise_pronta or
// analise_com_pendencias, prazoEm from that moment and the second e-mail to the administrator. A human edit
// gets only the code checks and keeps the state, the confidence and prazoEm.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { CLAUDE_API_KEY, REGIAO, SMTP2GO_API_KEY, URL_BASE_POR_PROJETO } from './config.js';
import { lePipeline } from './pipeline.js';
import { chamaClaude, ErroComUso, noEmulador } from './claude.js';
import { lePrecos } from './precos.js';
import { chaveDesenho, esforcoApi, esforcoDe, modeloDe } from './modelos.js';
import { promptTotal } from './custo.js';
import { usoChamada, type UsoChamada } from './uso.js';
import { leMetodo } from './metodo.js';
import { confiancaFinal } from './graduar.js';
import { avisoAnalise } from './email.js';
import { mesDe } from './qualificar.js';
import { ETAPAS_COLETA, coletaDe, fontesDisponiveis, rotuloDestino, rotuloQuadrante } from './sintese.js';
import {
  ESQUEMA_REVISOR, avisosDaColeta, avisosDoEnquadramento, checagens, mensagemRevisor, validaRevisor, vaiAoReparo, type AnaliseVerificada, type EtapaTexto, type Pendencia,
} from './verificacao.js';
import { regrasDoMetodo } from './metodoRegras.js';
import {
  ESQUEMA_DA_ETAPA, MAX_TOKENS_REPARO, avaliaReparo, camposDaEtapa, itensDeReparo, jsonDaEtapa, mensagemReparar, simulaReparo,
  type RegistroReparo, type VersaoTextos,
} from './reparo.js';

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

      // The method gives the vetoed terms, the grade names and the sections cited by [M:...] marks.
      const metodo = await leMetodo({ 'glossario.md': 'tudo', 'escopo-limites.md': 'tudo', 'portas-materiais.md': 'tudo', 'mapa-alavancas.md': 'tudo', 'livro-selecao.md': 'tudo' });
      const regras = regrasDoMetodo(Object.fromEntries(metodo.blocos.map((b) => [b.nome, b.texto])));
      const precos = await lePrecos();
      const nome = String(f.original?.nome ?? '');
      // Texts of the version, rewritten by an accepted repair.
      let textos: VersaoTextos = {
        secoes: a.secoes ?? {}, resumoExecutivo: a.resumoExecutivo ?? '', rascunhoResposta: a.rascunhoResposta ?? { assunto: '', corpo: '' },
        conversa: { perguntas: a.conversa?.perguntas ?? [], materiais: a.conversa?.materiais ?? [], pontosDeAtencao: a.conversa?.pontosDeAtencao ?? [] },
        enquadramento: a.enquadramento ?? {},
      };
      const verifica = (t: VersaoTextos): AnaliseVerificada => ({
        secoes: t.secoes, resumoExecutivo: t.resumoExecutivo, rascunhoResposta: t.rascunhoResposta, enquadramento: t.enquadramento?.detalhe ?? null,
        conversa: t.conversa, nome, lang: f.original?.lang ?? 'pt-BR',
        cnpjConfirmado: coleta.empresa_registro.status === 'concluida' && (coleta.empresa_registro.conteudo as any)?.confirmado === true,
      });

      // 4.1 – code checks, first pass.
      const primeira: Pendencia[] = checagens(verifica(textos), coleta, regras);
      const avisos = [...avisosDaColeta(coleta), ...avisosDoEnquadramento(a.enquadramento?.detalhe)];

      // 3.4 – repair, AI versions only: one call per stage with failures of the repair rules, in parallel.
      const reparos: RegistroReparo[] = [];
      const usosReparo: (UsoChamada & { origem: EtapaTexto })[] = [];
      const camposReparados: Partial<VersaoTextos> = {};
      const itens: ReturnType<typeof itensDeReparo> = ia ? itensDeReparo(primeira.filter(vaiAoReparo), regras, nome) : new Map();
      const resultados = await Promise.all([...itens].map(async ([etapa, lista]) => {
        const modelo = noEmulador() ? 'simulado' : modeloDe(p, 'reparar', etapa);
        const esforco = esforcoDe(p, 'reparar', etapa);
        const antes = jsonDaEtapa(etapa, textos);
        const inicio = Date.now();
        try {
          let saida: unknown;
          if (noEmulador()) {
            saida = simulaReparo(etapa, antes, lista, nome);
            usosReparo.push({ ...usoChamada(precos, modelo, esforco, null, 0), origem: etapa });
          } else {
            if (!modelo) throw new Error(`config/pipeline.modelos.${etapa} is empty`);
            const r = await chamaClaude({
              chave: CLAUDE_API_KEY.value(), modelo, usuario: mensagemReparar(etapa, antes, fontesDisponiveis(coleta), lista), esquema: ESQUEMA_DA_ETAPA[etapa],
              maxTokens: MAX_TOKENS_REPARO[etapa], timeoutMs: 300_000, esforco: esforcoApi(esforco),
            });
            usosReparo.push({ ...usoChamada(precos, modelo, esforco, r.uso, Date.now() - inicio), origem: etapa });
            saida = r.json;
          }
          const av = avaliaReparo(etapa, antes, saida, lista, p.limiarReparo);
          return { etapa, ...av };
        } catch (e) {
          // A failed repair call keeps the original text; its failures become issues. A billed failure counts.
          if (e instanceof ErroComUso) usosReparo.push({ ...usoChamada(precos, modelo, esforco, e.uso, Date.now() - inicio), origem: etapa });
          logger.warn('verificar: repair call failed', { id, versao, etapa, mensagem: String((e as Error)?.message ?? e).slice(0, 300) });
          return { etapa, ...avaliaReparo(etapa, antes, null, lista, p.limiarReparo), motivo: 'chamada falhou' };
        }
      }));
      for (const r of resultados) {
        reparos.push(...r.registros);
        if (r.aceito) Object.assign(camposReparados, camposDaEtapa(r.etapa, r.saida, textos, coleta));
      }
      textos = { ...textos, ...camposReparados };
      const pendencias: Pendencia[] = Object.keys(camposReparados).length ? checagens(verifica(textos), coleta, regras) : [...primeira];

      // 4.2 – reviewer, AI versions only; no access to the collection.
      // Model and effort from config/pipeline (modelos.revisor, esforco.revisor); usage in the same shape as
      // the synthesis calls (spec 01 v0.11, uso).
      let modeloRevisor: string | null = null;
      let usoRevisor: UsoChamada | null = null;
      if (ia) {
        const esforco = esforcoDe(p, 'revisor');
        modeloRevisor = noEmulador() ? 'simulado' : modeloDe(p, 'revisor');
        if (!modeloRevisor) throw new Error('config/pipeline.modelos.revisor is empty');
        let revisor: Pendencia[];
        if (noEmulador()) {
          revisor = [];
          usoRevisor = usoChamada(precos, modeloRevisor, esforco, null, 0);
        } else {
          const metodo = await leMetodo({ 'glossario.md': ['B'], 'escopo-limites.md': [1, 4, 5, 7] });
          const inicio = Date.now();
          const r = await chamaClaude({
            chave: CLAUDE_API_KEY.value(), modelo: modeloRevisor, metodo: metodo.blocos.map((b) => ({ nome: b.nome, texto: b.texto })),
            usuario: mensagemRevisor(textos.secoes, textos.enquadramento?.detalhe ?? textos.enquadramento ?? null), esquema: ESQUEMA_REVISOR, maxTokens: 32_000, timeoutMs: 480_000,
            esforco: esforcoApi(esforco),
          }).catch(async (e) => {
            // A billed failure still counts in the cost of the ficha.
            if (e instanceof ErroComUso) {
              const k = usoChamada(precos, modeloRevisor ?? '', esforco, e.uso, Date.now() - inicio);
              await ref.update({
                'custo.tokensEntrada': FieldValue.increment(promptTotal(k)), 'custo.tokensSaida': FieldValue.increment(k.tokensSaida),
                'custo.usdEstimado': FieldValue.increment(k.usdEstimado ?? 0),
              }).catch(() => undefined);
            }
            throw new Error(`revisor: ${String((e as Error)?.message ?? e)}`);
          });
          revisor = validaRevisor(r.json);
          usoRevisor = usoChamada(precos, modeloRevisor, esforco, r.uso, Date.now() - inicio);
        }
        pendencias.push(...revisor);
      }
      const usdReparo = usosReparo.reduce((t, u) => t + (u.usdEstimado ?? 0), 0);
      const usd = (usoRevisor?.usdEstimado ?? 0) + usdReparo;
      // Calls of this verification (repairs and reviewer), for the totals of uso and of the ficha.
      const chamadas: UsoChamada[] = [...usosReparo, ...(usoRevisor ? [usoRevisor] : [])];
      const soma = (k: 'tokensEntrada' | 'tokensSaida' | 'cacheLidos' | 'cacheEscritos' | 'duracaoMs' | 'usdSemCache') => chamadas.reduce((t, c) => t + (c[k] ?? 0), 0);
      const prompt = chamadas.reduce((t, c) => t + promptTotal(c), 0);
      // Design of the synthesis that produced the version, for metricas.sintesePorDesenho.
      const desenho = ia && a.uso ? chaveDesenho(a.uso) : null;

      const status = pendencias.length ? 'com_pendencias' : 'pronta';
      const agora = Timestamp.now();
      // Final state only for the current AI version of a ficha still in "sintetizando".
      const fecha = ia && f.estado === 'sintetizando' && f.analiseAtual === versao;
      const lead = ia ? await confiancaFinal(ref, f, pendencias.length > 0, fecha ? agora.toDate() : null) : {};
      const estado = status === 'pronta' ? 'analise_pronta' : 'analise_com_pendencias';

      await db.runTransaction(async (tx) => {
        const atual = (await tx.get(ref)).data();
        const v = (await tx.get(docVersao)).data();
        if (!atual || !v || v.verificacao) return;
        tx.update(docVersao, {
          verificacao: { status, pendencias, verificadaEm: agora, modeloRevisor, reparos, avisos },
          // Texts rewritten by an accepted repair (decision of Gon, 8/11/2026).
          ...camposReparados,
          ...(usoRevisor ? { 'uso.revisor': usoRevisor } : {}),
          ...(usosReparo.length ? { 'uso.reparar': usosReparo } : {}),
          ...(chamadas.length ? {
            'uso.total.tokensEntrada': FieldValue.increment(soma('tokensEntrada')),
            'uso.total.tokensSaida': FieldValue.increment(soma('tokensSaida')),
            'uso.total.cacheLidos': FieldValue.increment(soma('cacheLidos')),
            'uso.total.cacheEscritos': FieldValue.increment(soma('cacheEscritos')),
            'uso.total.duracaoMs': FieldValue.increment(soma('duracaoMs')),
            'uso.total.usdEstimado': FieldValue.increment(usd),
            'uso.total.usdSemCache': FieldValue.increment(soma('usdSemCache')),
          } : {}),
        });
        const aindaFecha = fecha && atual.estado === 'sintetizando' && atual.analiseAtual === versao;
        // The confidence follows the current AI version only.
        const naFicha = {
          ...(ia && atual.analiseAtual === versao ? lead : {}),
          ...(aindaFecha ? { estado, estadoEm: agora } : {}),
          ...(chamadas.length ? {
            'custo.tokensEntrada': FieldValue.increment(prompt),
            'custo.tokensSaida': FieldValue.increment(soma('tokensSaida')),
            'custo.usdEstimado': FieldValue.increment(usd),
          } : {}),
        };
        // A human edit changes nothing in the ficha itself.
        if (Object.keys(naFicha).length) tx.update(ref, naFicha);
        tx.create(ref.collection('eventos').doc(), {
          em: agora, ator: { tipo: ia ? 'ia' : 'sistema', id: 'verificar' }, tipo: 'verificacao',
          detalhe: { versao, status, pendencias: pendencias.length, porTipo: contaPorTipo(pendencias), revisor: ia, confianca: (lead as Record<string, unknown>)['lead.modificadores.confianca'] ?? null },
        });
        for (const r of resultados) {
          tx.create(ref.collection('eventos').doc(), {
            em: agora, ator: { tipo: 'ia', id: 'verificar' }, tipo: 'reparo',
            detalhe: { versao, etapa: r.etapa, regras: [...new Set(r.registros.map((x) => x.regra))], aceito: r.aceito, motivo: r.motivo },
          });
        }
        if (usoRevisor) {
          // Pending items by rule before the repair (first pass of the code checks) and after it; the
          // reviewer's items count in both. The correction of phase 4 changes "depois" again.
          const revisorItens = pendencias.filter((x) => x.tipo !== 'mecanica');
          const antes = contaPorRegra([...primeira, ...revisorItens]);
          const depois = contaPorRegra(pendencias);
          tx.set(
            db.collection('metricas').doc(mesDe((f.recebidaEm as Timestamp).toDate())),
            {
              custo: { verificacao: { usdEstimado: FieldValue.increment(usd), tokensEntrada: FieldValue.increment(prompt), tokensSaida: FieldValue.increment(soma('tokensSaida')) } },
              ...(desenho ? {
                sintesePorDesenho: {
                  [desenho]: {
                    usdEstimado: FieldValue.increment(usd), usdSemCache: FieldValue.increment(soma('usdSemCache')),
                    pendenciasPorRegra: {
                      antes: Object.fromEntries(Object.entries(antes).map(([k, n]) => [k, FieldValue.increment(n)])),
                      depois: Object.fromEntries(Object.entries(depois).map(([k, n]) => [k, FieldValue.increment(n)])),
                    },
                  },
                },
              } : {}),
              atualizadoEm: agora,
            },
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
            portaProvavel: a.enquadramento?.portaProvavel ?? '–', resumoExecutivo: textos.resumoExecutivo,
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

// Mechanical items by their rule; the reviewer's by type (revisor_<tipo>). Firestore map keys, no dots.
const contaPorRegra = (ps: Pendencia[]) =>
  ps.reduce<Record<string, number>>((t, x) => {
    const k = String(x.regra ?? `revisor_${x.tipo}`).replace(/[.\s/]/g, '_');
    return { ...t, [k]: (t[k] ?? 0) + 1 };
  }, {});
const contaPorTipo = (ps: Pendencia[]) => ps.reduce<Record<string, number>>((t, x) => ({ ...t, [x.tipo]: (t[x.tipo] ?? 0) + 1 }), {});
