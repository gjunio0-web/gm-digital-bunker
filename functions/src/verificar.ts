// verificar – runs on the creation of fichas/{id}/analise/{versao} (decision of Gon, 7/11/2026; spec 01 v0.11,
// section 4): the code checks of spec 02, 4.1 always; for an AI version, first the repair of spec 02 v0.12, 3.4
// (one call per stage with failures, then the checks again); for a synthesis or re-run, the reviewer of 4.2 on
// the repaired text and, with scope or reading issues, the correction of 4.3, written as vN+1 (whose own
// verification runs the checks with repair only, carries the treated issues and closes the state). Writes verificacao in the version; not done
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
import { chaveDesenho, comParametros, esforcoApi, esforcoDe, modeloDe } from './modelos.js';
import { promptTotal } from './custo.js';
import { reivindicaVerificacao } from './reivindicacao.js';
import { custoNaFicha, semPreco, usoChamada, type UsoChamada } from './uso.js';
import { leMetodo } from './metodo.js';
import { confiancaFinal } from './graduar.js';
import { avisoAnalise } from './email.js';
import { mesDe } from './qualificar.js';
import { ETAPAS_COLETA, coletaDe, fontesDisponiveis, portaParaExibir, rotuloDestino, rotuloQuadrante, secaoS0 } from './sintese.js';
import {
  comCnpjAConfirmar, esquemaRevisor, METODO_CORRECAO, METODO_REVISOR, avisosDaColeta, avisosDoEnquadramento, checagens, mensagemRevisor, simulaRevisor, validaRevisor, vaiAoReparo, type AnaliseVerificada,
  type EtapaTexto, type ItemChecklist, type Pendencia,
} from './verificacao.js';
import { checklistDoRevisor, regrasDoMetodo } from './metodoRegras.js';
import {
  analiseParaCorrecao, comMantidasDoEnquadramento, comTratamento, ehDoEnquadramento, mantidaPeloCodigo, mensagemCorrigir, prontaAposCorrecao,
  simulaCorrecao, validaCorrecao, vaiACorrecao, versaoCorrigida,
  type TratamentoDado,
} from './correcao.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import { totalDe } from './uso.js';
import {
  ESQUEMA_DA_ETAPA, MAX_TOKENS_REPARO, avaliaReparo, camposDaEtapa, itensDeReparo, jsonDaEtapa, mensagemReparar, semLinks, simulaReparo,
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
      // Only one run per version (phase 6, item 2).
      if (!(await reivindicaVerificacao(db, docVersao))) {
        logger.info('verificar: version already claimed', { id, versao });
        return;
      }
      // Run parameters of the synthesis behind the version (phase B2): reparar and corrigir inherit from them.
      const p = comParametros(await lePipeline(), a.parametrosSintese ?? null);
      const f = (await ref.get()).data();
      if (!f) return;
      const snaps = await Promise.all(ETAPAS_COLETA.map((e) => ref.collection('coleta').doc(e).get()));
      const coleta = coletaDe(Object.fromEntries(ETAPAS_COLETA.map((e, i) => [e, snaps[i].data()])));

      // The method gives the vetoed terms, the grade names and the sections cited by [M:...] marks.
      const metodo = await leMetodo({ 'glossario.md': 'tudo', 'escopo-limites.md': 'tudo', 'portas-materiais.md': 'tudo', 'mapa-alavancas.md': 'tudo', 'livro-selecao.md': 'tudo' });
      const regras = regrasDoMetodo(Object.fromEntries(metodo.blocos.map((b) => [b.nome, b.texto])));
      const precos = await lePrecos();
      const nome = String(f.original?.nome ?? '');
      // Cost of each call in the ficha right after it, billed failures included (phase 6, item 3b): an
      // interruption of the function does not lose the cost already paid. The closing does not add it again.
      const cobra = (u: UsoChamada) =>
        ref.update(custoNaFicha(u)).catch((e) => logger.warn('verificar: cost not written', { id, versao, mensagem: String((e as Error)?.message ?? e).slice(0, 200) }));
      // Emulator: "correção" in the message makes the simulated reviewer raise one issue, to run the correction.
      const comCorrecaoSimulada = /corre[çc][ãa]o/i.test(String(f.original?.mensagem ?? ''));
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

      // cnpj_a_confirmar is applied by the code (spec 02 v0.16, 4.1): "CNPJ a confirmar." as the last paragraph
      // of s2 when the CNPJ is not confirmed and s2 does not say so; written with the version, with no issue.
      const camposCodigo: Partial<VersaoTextos> = {};
      const s2Cnpj = comCnpjAConfirmar(textos.secoes.s2, verifica(textos).cnpjConfirmado);
      if (s2Cnpj !== null) {
        textos = { ...textos, secoes: { ...textos.secoes, s2: { ...textos.secoes.s2, corpo: s2Cnpj } } };
        camposCodigo.secoes = textos.secoes;
      }

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
            await cobra(usosReparo[usosReparo.length - 1]);
          } else {
            if (!modelo) throw new Error(`config/pipeline.modelos.${etapa} is empty`);
            const r = await chamaClaude({
              chave: CLAUDE_API_KEY.value(), modelo, usuario: mensagemReparar(etapa, antes, fontesDisponiveis(coleta), lista), esquema: ESQUEMA_DA_ETAPA[etapa],
              maxTokens: MAX_TOKENS_REPARO[etapa], timeoutMs: 300_000, esforco: esforcoApi(esforco),
            });
            const u = { ...usoChamada(precos, modelo, esforco, r.uso, Date.now() - inicio), origem: etapa };
            usosReparo.push(u);
            await cobra(u);
            saida = r.json;
          }
          const av = avaliaReparo(etapa, antes, saida, lista, p.limiarReparo);
          return { etapa, ...av };
        } catch (e) {
          // A failed repair call keeps the original text; its failures become issues. A billed failure counts.
          if (e instanceof ErroComUso) {
            const u = { ...usoChamada(precos, modelo, esforco, e.uso, Date.now() - inicio), origem: etapa };
            usosReparo.push(u);
            await cobra(u);
          }
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

      // 4.2 – reviewer, for AI versions of a synthesis or re-run only (not for a correction version): Part 1
      // checklist generated from escopo-limites.md, Part 2 reading. Model and effort from config/pipeline;
      // no temperature: Claude 5.x models reject sampling parameters (migration guide of Sonnet 5.5).
      const origem: string = a.autor?.origem ?? 'sintese';
      const revisa = ia && (origem === 'sintese' || origem === 'reexecucao');
      const ehCorrecao = ia && origem === 'correcao';
      let modeloRevisor: string | null = null;
      let usoRevisor: UsoChamada | null = null;
      let checklist: ItemChecklist[] = [];
      if (revisa) {
        const esforco = esforcoDe(p, 'revisor');
        modeloRevisor = noEmulador() ? 'simulado' : modeloDe(p, 'revisor');
        if (!modeloRevisor) throw new Error('config/pipeline.modelos.revisor is empty');
        const regrasChecklist = checklistDoRevisor(regras.arquivos['escopo-limites.md'] ?? '');
        const insumo = { secoes: textos.secoes, enquadramento: textos.enquadramento?.detalhe ?? null, conversa: textos.conversa, rascunhoResposta: textos.rascunhoResposta };
        let saida: unknown;
        if (noEmulador()) {
          saida = simulaRevisor(regrasChecklist, semLinks(textos.secoes.s1?.corpo ?? ''), comCorrecaoSimulada);
          usoRevisor = usoChamada(precos, modeloRevisor, esforco, null, 0);
          await cobra(usoRevisor);
        } else {
          const metodoRevisor = await leMetodo(METODO_REVISOR);
          const inicio = Date.now();
          const r = await chamaClaude({
            chave: CLAUDE_API_KEY.value(), modelo: modeloRevisor, metodo: metodoRevisor.blocos.map((b) => ({ nome: b.nome, texto: b.texto })),
            usuario: mensagemRevisor(insumo, regrasChecklist), esquema: esquemaRevisor(regrasChecklist.map((r) => r.regra)), maxTokens: 32_000, timeoutMs: 480_000,
            esforco: esforcoApi(esforco),
          }).catch(async (e) => {
            // A billed failure still counts in the cost of the ficha.
            if (e instanceof ErroComUso) await cobra(usoChamada(precos, modeloRevisor ?? '', esforco, e.uso, Date.now() - inicio));
            throw new Error(`revisor: ${String((e as Error)?.message ?? e)}`);
          });
          saida = r.json;
          usoRevisor = usoChamada(precos, modeloRevisor, esforco, r.uso, Date.now() - inicio);
          await cobra(usoRevisor);
        }
        const rev = validaRevisor(saida, Object.fromEntries(regrasChecklist.map((r) => [r.regra, r.nome])));
        checklist = rev.checklist;
        pendencias.push(...rev.pendencias);
      }

      // A correction version carries the issues of its base with their treatment (spec 02 v0.12, 4.3).
      const carregadas = ehCorrecao ? comTratamento(a.correcao?.pendencias ?? [], a.correcao?.tratamentos ?? []) : [];
      if (ehCorrecao) avisos.push(...(a.correcao?.avisos ?? []));
      // Issues located in the enquadramento never go to the correction (spec 02 v0.16, 4.3): the code marks them
      // as kept, with the reason, whenever a correction would be considered.
      const corrigivel = revisa && p.correcaoAtiva && ia && f.estado === 'sintetizando' && f.analiseAtual === versao;
      if (corrigivel) for (let i = 0; i < pendencias.length; i++) if (ehDoEnquadramento(pendencias[i])) pendencias[i] = mantidaPeloCodigo(pendencias[i]);
      const todas: Pendencia[] = [...pendencias, ...carregadas];
      const status = ehCorrecao ? (prontaAposCorrecao(pendencias, carregadas) ? 'pronta' : 'com_pendencias') : todas.length ? 'com_pendencias' : 'pronta';
      const agora = Timestamp.now();
      // Final state only for the current AI version of a ficha still in "sintetizando".
      const fechaSeNaoCorrigir = ia && f.estado === 'sintetizando' && f.analiseAtual === versao;

      // 4.3 – correction: one call when the reviewer left scope or reading issues; the answer becomes vN+1.
      const paraCorrigir = corrigivel ? todas.filter((x) => vaiACorrecao(x) && !ehDoEnquadramento(x)) : [];
      const mantidasNoEnquadramento = corrigivel ? todas.filter((x) => vaiACorrecao(x) && ehDoEnquadramento(x)) : [];
      let correcao: { versao: string; doc: Record<string, unknown>; uso: UsoChamada; tratamentos: TratamentoDado[] } | null = null;
      let usoCorrecaoFalha: UsoChamada | null = null;
      if (paraCorrigir.length) {
        const modelo = noEmulador() ? 'simulado' : modeloDe(p, 'corrigir');
        const esforco = esforcoDe(p, 'corrigir');
        const analise = analiseParaCorrecao(textos);
        const inicio = Date.now();
        // Usage of an answer that came back but was refused by the checks (phase B2: without the strict
        // schema the format is checked here); already in the ficha cost, kept for the version usage.
        let usoRecebido: UsoChamada | null = null;
        try {
          let saida: unknown;
          let uso: UsoChamada;
          if (noEmulador()) {
            saida = simulaCorrecao(analise, paraCorrigir);
            uso = usoChamada(precos, modelo, esforco, null, 0);
            await cobra(uso);
          } else {
            if (!modelo) throw new Error('config/pipeline.modelos.corrigir is empty');
            const metodoCorrecao = await leMetodo(METODO_CORRECAO);
            const r = await chamaClaude({
              chave: CLAUDE_API_KEY.value(), modelo, metodo: metodoCorrecao.blocos.map((b) => ({ nome: b.nome, texto: b.texto })),
              usuario: mensagemCorrigir(analise, fontesDisponiveis(coleta), paraCorrigir), maxTokens: 64_000, timeoutMs: 300_000,
              esforco: esforcoApi(esforco),
            });
            saida = r.json;
            uso = usoChamada(precos, modelo, esforco, r.uso, Date.now() - inicio);
            await cobra(uso);
            usoRecebido = uso;
          }
          const c = comMantidasDoEnquadramento(validaCorrecao(saida, paraCorrigir.length), mantidasNoEnquadramento.length);
          const { campos, avisos: avisosCorrecao } = versaoCorrigida(textos, c, coleta);
          const nova = `v${(await ref.collection('analise').get()).size + 1}`;
          const s0 = secaoS0({
            empresa: f.original?.empresa ?? '', rotuloCargo: CARGOS_ROTULO[f.original?.cargo] ?? f.original?.cargo ?? '', recebidaEm: (f.recebidaEm as Timestamp).toDate(),
            criadaEm: agora.toDate(), versao: nova, lead: f.lead, versaoMetodo: a.versaoMetodo ?? metodo.versao, modelo,
          });
          correcao = {
            versao: nova,
            uso,
            tratamentos: c.tratamentos,
            doc: {
              autor: { tipo: 'ia', id: modelo, origem: 'correcao' },
              baseadaEm: versao,
              versaoMetodo: a.versaoMetodo ?? metodo.versao,
              parametrosSintese: a.parametrosSintese ?? null,
              secoes: { ...campos.secoes, s0 },
              enquadramento: campos.enquadramento,
              resumoExecutivo: campos.resumoExecutivo,
              conversa: campos.conversa,
              rascunhoResposta: campos.rascunhoResposta,
              correcao: { pendencias: [...paraCorrigir, ...mantidasNoEnquadramento], tratamentos: c.tratamentos, avisos: avisosCorrecao },
              uso: { corrigir: uso, total: totalDe([uso]) },
              criadaEm: agora,
            },
          };
        } catch (e) {
          // Without a correction, vN closes as before; a billed failure still counts.
          if (e instanceof ErroComUso) {
            usoCorrecaoFalha = usoChamada(precos, modelo, esforco, e.uso, Date.now() - inicio);
            await cobra(usoCorrecaoFalha);
          } else if (usoRecebido) usoCorrecaoFalha = usoRecebido;
          const mensagem = String((e as Error)?.message ?? e).slice(0, 300);
          // Recorded in the version, so the rate of refused corrections can be measured (phase B2).
          avisos.push(`correcao_falhou: ${mensagem.slice(0, 160)}`);
          logger.warn('verificar: correction failed', { id, versao, mensagem });
        }
      }

      const fecha = fechaSeNaoCorrigir && !correcao;
      const lead = ia && !correcao ? await confiancaFinal(ref, f, status !== 'pronta', fecha ? agora.toDate() : null) : {};
      const estado = status === 'pronta' ? 'analise_pronta' : 'analise_com_pendencias';

      const usdReparo = usosReparo.reduce((t, u) => t + (u.usdEstimado ?? 0), 0);
      // Calls of this verification (repairs and reviewer) count in vN; the correction counts in vN+1; all in the ficha.
      const chamadas: UsoChamada[] = [...usosReparo, ...(usoRevisor ? [usoRevisor] : []), ...(usoCorrecaoFalha ? [usoCorrecaoFalha] : [])];
      const usd = chamadas.reduce((t, c) => t + (c.usdEstimado ?? 0), 0);
      const daFicha = [...chamadas, ...(correcao ? [correcao.uso] : [])];
      const usdFicha = daFicha.reduce((t, c) => t + (c.usdEstimado ?? 0), 0);
      // Calls of this version without a price in config/precos (phase 6, item 5): the synthesis (or the
      // correction that made the version), the repairs, the reviewer and a failed correction.
      avisos.push(...semPreco([
        ...Object.entries((a.uso ?? {}) as Record<string, any>).filter(([k]) => k !== 'total' && k !== 'reparar' && k !== 'revisor'),
        ...usosReparo.map((u): [string, UsoChamada] => [`reparar.${u.origem}`, u]),
        ...(usoRevisor ? [['revisor', usoRevisor] as [string, UsoChamada]] : []),
        ...(usoCorrecaoFalha ? [['corrigir', usoCorrecaoFalha] as [string, UsoChamada]] : []),
      ]));
      const soma = (cs: UsoChamada[], k: 'tokensEntrada' | 'tokensSaida' | 'cacheLidos' | 'cacheEscritos' | 'duracaoMs' | 'usdSemCache') => cs.reduce((t, c) => t + (c[k] ?? 0), 0);
      const prompt = (cs: UsoChamada[]) => cs.reduce((t, c) => t + promptTotal(c), 0);
      // Design of the synthesis behind the version, for metricas.sintesePorDesenho; a correction version reads
      // it from its base.
      const usoBase = ehCorrecao && a.baseadaEm ? (await ref.collection('analise').doc(a.baseadaEm).get()).get('uso') : a.uso;
      const desenho = ia && usoBase ? chaveDesenho(usoBase) : null;

      await db.runTransaction(async (tx) => {
        const atual = (await tx.get(ref)).data();
        const v = (await tx.get(docVersao)).data();
        const docNova = correcao ? ref.collection('analise').doc(correcao.versao) : null;
        const jaExiste = docNova ? (await tx.get(docNova)).exists : false;
        if (!atual || !v || v.verificacao) return;
        // The correction is written only while vN is still the current version of a ficha in "sintetizando".
        const grava = !!correcao && !jaExiste && atual.estado === 'sintetizando' && atual.analiseAtual === versao;
        tx.update(docVersao, {
          verificacao: {
            status, pendencias: ehCorrecao ? todas : pendencias, verificadaEm: agora, modeloRevisor, reparos, avisos, checklist,
            ...(grava ? { corrigidaEm: correcao!.versao } : {}),
          },
          // Texts changed by the code (cnpj_a_confirmar) and rewritten by an accepted repair (decision of Gon, 8/11/2026).
          ...camposCodigo,
          ...camposReparados,
          ...(usoRevisor ? { 'uso.revisor': usoRevisor } : {}),
          ...(usosReparo.length ? { 'uso.reparar': usosReparo } : {}),
          ...(chamadas.length ? {
            'uso.total.tokensEntrada': FieldValue.increment(soma(chamadas, 'tokensEntrada')),
            'uso.total.tokensSaida': FieldValue.increment(soma(chamadas, 'tokensSaida')),
            'uso.total.cacheLidos': FieldValue.increment(soma(chamadas, 'cacheLidos')),
            'uso.total.cacheEscritos': FieldValue.increment(soma(chamadas, 'cacheEscritos')),
            'uso.total.duracaoMs': FieldValue.increment(soma(chamadas, 'duracaoMs')),
            'uso.total.usdEstimado': FieldValue.increment(usd),
            'uso.total.usdSemCache': FieldValue.increment(soma(chamadas, 'usdSemCache')),
          } : {}),
        });
        if (grava) tx.create(docNova!, correcao!.doc);
        const aindaFecha = fecha && atual.estado === 'sintetizando' && atual.analiseAtual === versao;
        const custos = grava ? daFicha : chamadas;
        // The confidence follows the current AI version only.
        const naFicha = {
          ...(ia && !grava && atual.analiseAtual === versao ? lead : {}),
          ...(aindaFecha ? { estado, estadoEm: agora } : {}),
          ...(grava ? { analiseAtual: correcao!.versao } : {}),
          // The cost of each call is already in the ficha (cobra).
        };
        // A human edit changes nothing in the ficha itself.
        if (Object.keys(naFicha).length) tx.update(ref, naFicha);
        tx.create(ref.collection('eventos').doc(), {
          em: agora, ator: { tipo: ia ? 'ia' : 'sistema', id: 'verificar' }, tipo: 'verificacao',
          detalhe: { versao, status, pendencias: (ehCorrecao ? todas : pendencias).length, porTipo: contaPorTipo(ehCorrecao ? todas : pendencias), revisor: revisa, confianca: (lead as Record<string, unknown>)['lead.modificadores.confianca'] ?? null },
        });
        for (const r of resultados) {
          tx.create(ref.collection('eventos').doc(), {
            em: agora, ator: { tipo: 'ia', id: 'verificar' }, tipo: 'reparo',
            detalhe: { versao, etapa: r.etapa, regras: [...new Set(r.registros.map((x) => x.regra))], aceito: r.aceito, motivo: r.motivo },
          });
        }
        if (grava) {
          tx.create(ref.collection('eventos').doc(), {
            em: agora, ator: { tipo: 'ia', id: 'verificar' }, tipo: 'correcao',
            detalhe: {
              versaoBase: versao, versao: correcao!.versao,
              corrigidas: correcao!.tratamentos.filter((t) => t.tratamento === 'corrigida').length,
              mantidas: correcao!.tratamentos.filter((t) => t.tratamento === 'mantida').length,
            },
          });
        }
        if (ia) {
          // Metrics by design (spec 01 v0.11, metricas): pending items by rule before the repair (first pass of
          // the code checks) and after it, checklist violations by rule, corrected and kept issues, cost.
          const revisorItens = pendencias.filter((x) => x.tipo !== 'mecanica');
          const antes = contaPorRegra([...primeira, ...revisorItens]);
          const depois = contaPorRegra(pendencias);
          const violadas = checklist.filter((x) => x.resultado === 'violado').reduce<Record<string, number>>((t, x) => ({ ...t, [chave(x.regra)]: (t[chave(x.regra)] ?? 0) + 1 }), {});
          const inc = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, n]) => [k, FieldValue.increment(n)]));
          const usdMetrica = grava ? usdFicha : usd;
          tx.set(
            db.collection('metricas').doc(mesDe((f.recebidaEm as Timestamp).toDate())),
            {
              custo: { verificacao: { usdEstimado: FieldValue.increment(usdMetrica), tokensEntrada: FieldValue.increment(prompt(custos)), tokensSaida: FieldValue.increment(soma(custos, 'tokensSaida')) } },
              ...(desenho ? {
                sintesePorDesenho: {
                  [desenho]: {
                    usdEstimado: FieldValue.increment(usdMetrica), usdSemCache: FieldValue.increment(soma(custos, 'usdSemCache')),
                    pendenciasPorRegra: { antes: inc(antes), depois: inc(depois) },
                    ...(Object.keys(violadas).length ? { checklistViolado: inc(violadas) } : {}),
                    ...(ehCorrecao ? {
                      versoesCorrecao: FieldValue.increment(1),
                      tratamentos: inc({ corrigida: carregadas.filter((x) => x.tratamento === 'corrigida').length, mantida: carregadas.filter((x) => x.tratamento === 'mantida').length }),
                    } : {}),
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
            fichaId: id, empresa: g.original?.empresa ?? '', versao, pronta: status === 'pronta', pendencias: (ehCorrecao ? todas.filter((x: any) => x.tratamento !== 'corrigida') : todas).length,
            quadrante: rotuloQuadrante(l.quadrante), destino: rotuloDestino(l.destino), grau: l.grau, pontos: l.pontos,
            confianca: l.modificadores?.confianca, confiancaMotivo: l.modificadores?.confiancaMotivo ?? '',
            prazoEm: l.acao?.prazoEm ? (l.acao.prazoEm as Timestamp).toDate() : null,
            portaProvavel: portaParaExibir(textos.enquadramento as any), resumoExecutivo: textos.resumoExecutivo,
            link: base ? `${base}/admin/leads/${id}` : `fichas/${id}`,
          }).catch(async (e) => {
            const mensagem = String((e as Error)?.message ?? e).slice(0, 300);
            logger.error('verificar: e-mail failed', { id, mensagem });
            await ref.update({ erro: { etapa: 'verificar.email', mensagem, em: Timestamp.now() } }).catch(() => undefined);
          });
        }
      }
      logger.info('verificar: done', { id, versao, status, pendencias: todas.length, revisor: revisa, correcao: correcao?.versao ?? null });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('verificar failed', { id, versao, mensagem });
      await ref.update({ erro: { etapa: 'verificar', mensagem, em: Timestamp.now() } }).catch(() => undefined);
    }
  },
);

const chave = (k: string) => k.replace(/[.\s/]/g, '_');

// Mechanical items by their rule; the reviewer's by type (revisor_<tipo>). Firestore map keys, no dots.
const contaPorRegra = (ps: Pendencia[]) =>
  ps.reduce<Record<string, number>>((t, x) => {
    const k = String(x.regra ?? `revisor_${x.tipo}`).replace(/[.\s/]/g, '_');
    return { ...t, [k]: (t[k] ?? 0) + 1 };
  }, {});
const contaPorTipo = (ps: Pendencia[]) => ps.reduce<Record<string, number>>((t, x) => ({ ...t, [x.tipo]: (t[x.tipo] ?? 0) + 1 }), {});
