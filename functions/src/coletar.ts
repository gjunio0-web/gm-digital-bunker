// coletar – runs when a ficha moves to "coletando" (spec 01, sections 2 to 4; spec 02, section 2;
// spec 03). Six stages, each isolated: empresa_digital, empresa_pessoas and empresa_noticias in
// parallel; empresa_registro after empresa_digital (needs the site text for the CNPJ); setor after
// registro and digital; mercado after setor. Then the ficha moves to "coletada".
// A stage already "concluida" with the same method version is not run again (no new API call).
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { APIFY_TOKEN, APOLLO_API_KEY, CLAUDE_API_KEY, HUNTER_API_KEY, REGIAO, type Fornecedor, type Pipeline } from './config.js';
import { lePipeline } from './pipeline.js';
import { leMetodo } from './metodo.js';
import { noEmulador } from './claude.js';
import { custoDe } from './custo.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import { dominioDe } from './qualificacao.js';
import { chamaColeta, chaveUrl, type RespostaColeta } from './coleta/claudeColeta.js';
import { formatoInvalido, normalizaEnvelope, type Envelope, type FonteColeta } from './coleta/envelope.js';
import { CHAVES, ETAPAS, INSTRUCAO_CANDIDATOS, MAX_BUSCAS, MAX_LEITURAS, METODO_DA_ETAPA, mensagemDaEtapa, type DadosFicha, type Etapa } from './coleta/etapas.js';
import { leSite, type LeituraSite } from './coleta/site.js';
import { cnpjValido, consultaBrasilApi, type RegistroBrasilApi } from './coleta/cnpj.js';
import { consultaApify, consultaApollo, consultaHunter, type Instagram } from './coleta/fornecedores.js';
import type { Normalizado, Original } from './validacao.js';

const mesDe = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);

interface Contexto {
  id: string;
  ref: DocumentReference;
  ficha: DadosFicha;
  email: string;
  qualificacao: Record<string, any>;
  p: Pipeline;
  versao: string;
  chaves: { claude: string; apollo: string; apify: string; hunter: string };
  buscasRestantes: number;
  chamadas: Record<Fornecedor, number>;
  conteudos: Partial<Record<Etapa, Record<string, unknown>>>;
  site: LeituraSite | null;
  totais: { tokensEntrada: number; tokensSaida: number; buscas: number; usd: number };
}

interface Saida {
  envelope: Envelope;
  uso: { tokensEntrada: number; tokensSaida: number; buscas: number; usd: number };
  chamadas: Partial<Record<Fornecedor, number>>;
}

const agoraIso = () => new Date().toISOString();

// Provider allowed for this ficha: active in config, key present (BrasilAPI needs none), under its cap.
function pode(c: Contexto, f: Fornecedor): boolean {
  const chave = { brasilapi: 'x', apollo: c.chaves.apollo, apify: c.chaves.apify, hunter: c.chaves.hunter }[f];
  return !noEmulador() && c.p.fontes[f].ativo && Boolean(chave) && c.chamadas[f] < c.p.fontes[f].maxChamadasPorFicha;
}

// One model call of a stage, with the search budget reserved and refunded.
async function chama(c: Contexto, etapa: Etapa, usuario: string, maxBuscas: number, valida: (j: unknown) => string | null): Promise<RespostaColeta> {
  const reserva = Math.max(0, Math.min(maxBuscas, c.buscasRestantes));
  c.buscasRestantes -= reserva;
  try {
    const met = METODO_DA_ETAPA[etapa];
    const metodo = met ? (await leMetodo(met)).blocos.map((b) => ({ nome: b.nome, texto: b.texto })) : [];
    const r = await chamaColeta({ chave: c.chaves.claude, modelo: c.p.modeloColeta, metodo, usuario, maxBuscas: reserva, maxLeituras: MAX_LEITURAS, valida });
    c.buscasRestantes += reserva - Math.min(reserva, r.buscas);
    return r;
  } catch (e) {
    c.buscasRestantes += reserva;
    throw e;
  }
}

// Emulator stand-in: a valid envelope with every field "não encontrado" and the given sources.
function simula(etapa: Etapa, fontes: FonteColeta[]): RespostaColeta {
  return {
    json: {
      conteudo: Object.fromEntries(CHAVES[etapa].map((k) => [k, null])),
      fontes,
      afirmacoes: [{ texto: `simulação da etapa ${etapa}`, tipo: 'nao_encontrado', fonteIdx: [] }],
      confianca: { grau: 'baixa', motivo: 'coleta simulada no emulador' },
    },
    uso: { input_tokens: 0, output_tokens: 0 },
    buscas: 0,
    leituras: 0,
    urlsConsultadas: new Set(),
  };
}

// Model call of a stage with the envelope, then source verification.
async function envelopeDaEtapa(c: Contexto, etapa: Etapa, fontes: FonteColeta[], insumos: Record<string, unknown>, maxBuscas: number, extraVerificadas: string[] = []): Promise<{ env: Envelope; r: RespostaColeta }> {
  const usuario = mensagemDaEtapa(etapa, c.ficha, c.qualificacao, fontes, insumos);
  const r = noEmulador() ? simula(etapa, fontes) : await chama(c, etapa, usuario, maxBuscas, (j) => formatoInvalido(j, CHAVES[etapa]));
  const verificadas = new Set([...fontes.map((f) => chaveUrl(f.url)), ...extraVerificadas.map(chaveUrl), ...r.urlsConsultadas]);
  return { env: normalizaEnvelope(r.json as Record<string, any>, verificadas, agoraIso()), r };
}

const usoDe = (c: Contexto, rs: RespostaColeta[]) => {
  const soma = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let buscas = 0;
  for (const r of rs) {
    soma.input_tokens += r.uso.input_tokens;
    soma.output_tokens += r.uso.output_tokens;
    soma.cache_creation_input_tokens += r.uso.cache_creation_input_tokens ?? 0;
    soma.cache_read_input_tokens += r.uso.cache_read_input_tokens ?? 0;
    buscas += r.buscas;
  }
  const k = custoDe(c.p.modeloColeta, soma, buscas);
  return { tokensEntrada: k.tokensEntrada, tokensSaida: k.tokensSaida, buscas, usd: k.usdEstimado ?? 0 };
};

// --- Stages ---------------------------------------------------------------------------------

async function empresaDigital(c: Contexto): Promise<Saida> {
  const fontes: FonteColeta[] = [];
  const chamadas: Partial<Record<Fornecedor, number>> = {};
  const site = c.qualificacao.siteResolvido as string | null;
  const leitura = site && !noEmulador() ? await leSite(site) : null;
  c.site = leitura;
  for (const pg of leitura?.paginas ?? []) fontes.push({ url: pg.url, titulo: pg.titulo || pg.tipo, tipo: 'pagina', consultadoEm: agoraIso() });

  let apollo: unknown = 'não consultado';
  const dominio = site ? new URL(site).hostname.replace(/^www\./, '') : null;
  if (dominio && pode(c, 'apollo')) {
    c.chamadas.apollo++;
    chamadas.apollo = 1;
    const a = await consultaApollo(c.chaves.apollo, dominio).catch(() => ({ status: 0, dados: null }));
    apollo = a.dados ?? `sem correspondência (HTTP ${a.status})`;
    if (a.dados) fontes.push({ url: `https://api.apollo.io/api/v1/organizations/enrich?domain=${dominio}`, titulo: 'Apollo – enriquecimento de empresa pelo domínio', tipo: 'api', consultadoEm: agoraIso() });
  }

  let instagram: Instagram | null = null;
  if (leitura?.instagram && pode(c, 'apify')) {
    c.chamadas.apify++;
    chamadas.apify = 1;
    instagram = (await consultaApify(c.chaves.apify, leitura.instagram).catch(() => ({ status: 0, dados: null }))).dados;
    if (instagram) fontes.push({ url: `https://www.instagram.com/${instagram.perfil}/`, titulo: 'Instagram da empresa (Apify)', tipo: 'api', consultadoEm: agoraIso() });
  }

  const insumos = {
    paginasDoSite: leitura ? leitura.paginas.map((pg, i) => `[fonte ${i}] ${pg.tipo} – ${pg.url}\n${pg.texto}`).join('\n\n') : site ? 'site não lido' : 'sem site',
    falhasDeLeitura: leitura?.falhas.length ? leitura.falhas : undefined,
    tecnologiasDetectadas: leitura?.tecnologias,
    cnpjsNoSite: leitura?.cnpjs,
    apollo,
    instagram: instagram ? { ...instagram, origemPerfil: 'site' } : leitura?.instagram ? `perfil linkado no site: ${leitura.instagram} (sem dados do Apify)` : 'sem link de Instagram no site',
  };
  const { env, r } = await envelopeDaEtapa(c, 'empresa_digital', fontes, insumos, MAX_BUSCAS.empresa_digital);

  // Profile found by search: Apify only if the profile name cites the company (spec 03, 4.2).
  const ig = env.conteudo.instagram as Record<string, any> | null;
  if (!instagram && ig?.perfil && ig.origemPerfil === 'busca' && pode(c, 'apify')) {
    const palavras = c.ficha.empresa.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter((w) => w.length >= 4);
    const perfil = String(ig.perfil).replace(/^@/, '').toLowerCase();
    if (palavras.some((w) => perfil.includes(w))) {
      c.chamadas.apify++;
      chamadas.apify = 1;
      const d = (await consultaApify(c.chaves.apify, perfil).catch(() => ({ status: 0, dados: null }))).dados;
      if (d) {
        const idx = env.fontes.push({ url: `https://www.instagram.com/${d.perfil}/`, titulo: 'Instagram (Apify), perfil achado por busca', tipo: 'api', consultadoEm: agoraIso() }) - 1;
        env.conteudo.instagram = { perfil: d.perfil, origemPerfil: 'busca', seguidores: d.seguidores, publicacoes: d.publicacoes, bio: d.bio, legendasRecentes: d.legendasRecentes };
        env.afirmacoes.push({ texto: `Perfil de Instagram ${d.perfil}, achado por busca, com dados do Apify (inferência: perfil da empresa).`, tipo: 'inferencia', fonteIdx: [idx] });
      }
    }
  }
  return { envelope: env, uso: usoDe(c, [r]), chamadas };
}

async function empresaRegistro(c: Contexto): Promise<Saida> {
  const chamadas: Partial<Record<Fornecedor, number>> = {};
  const rs: RespostaColeta[] = [];
  const fontes: FonteColeta[] = [];
  const extras: string[] = [];
  let candidatos = (c.site?.cnpjs ?? []).map((cnpj) => ({ cnpj, origem: 'site', url: c.site!.paginas[0]?.url ?? '' }));
  let buscasPrincipal = MAX_BUSCAS.empresa_registro;

  if (!candidatos.length && !noEmulador()) {
    // Step 1: candidates by web search only; the code checks digits and BrasilAPI before any acceptance.
    const usuario = [
      `<ficha>\nempresa: ${c.ficha.empresa}\nsite: ${c.ficha.site ?? '–'}\ndomínio do e-mail: ${c.ficha.dominioEmail}\n</ficha>`,
      `<insumo nome="empresa_digital">\n${JSON.stringify({ presencaGeografica: c.conteudos.empresa_digital?.presencaGeografica ?? null, apollo: c.conteudos.empresa_digital?.apollo ?? null })}\n</insumo>`,
      INSTRUCAO_CANDIDATOS,
    ].join('\n');
    const r = await chama(c, 'empresa_registro', usuario, MAX_BUSCAS.empresa_registro, (j) => (Array.isArray((j as any)?.candidatos) ? null : 'candidatos missing'));
    rs.push(r);
    extras.push(...r.urlsConsultadas);
    buscasPrincipal = 0;
    candidatos = ((r.json as any).candidatos as any[])
      .filter((k) => typeof k?.cnpj === 'string' && cnpjValido(k.cnpj) && typeof k.url === 'string' && r.urlsConsultadas.has(chaveUrl(k.url)))
      .slice(0, 3)
      .map((k) => ({ cnpj: k.cnpj.replace(/\D/g, ''), origem: 'busca', url: k.url }));
    for (const k of candidatos) fontes.push({ url: k.url, titulo: `página onde o candidato ${k.cnpj} apareceu`, tipo: 'busca', consultadoEm: agoraIso() });
  }

  const registros: (RegistroBrasilApi | { cnpj: string; erro: string })[] = [];
  for (const k of candidatos) {
    if (!pode(c, 'brasilapi')) break;
    c.chamadas.brasilapi++;
    chamadas.brasilapi = (chamadas.brasilapi ?? 0) + 1;
    const b = await consultaBrasilApi(k.cnpj).catch(() => ({ status: 0, registro: null }));
    if (b.registro) {
      registros.push(b.registro);
      fontes.push({ url: `https://brasilapi.com.br/api/cnpj/v1/${k.cnpj}`, titulo: `BrasilAPI – CNPJ ${k.cnpj}`, tipo: 'api', consultadoEm: agoraIso() });
    } else registros.push({ cnpj: k.cnpj, erro: `HTTP ${b.status}` });
  }

  const insumos = {
    candidatos: candidatos.length ? candidatos : 'nenhum candidato com dígitos válidos',
    registrosBrasilApi: registros.length ? registros : undefined,
    empresaDigital: c.conteudos.empresa_digital ?? 'etapa empresa_digital sem conteúdo',
  };
  const { env, r } = await envelopeDaEtapa(c, 'empresa_registro', fontes, insumos, buscasPrincipal, extras);
  rs.push(r);
  return { envelope: env, uso: usoDe(c, rs), chamadas };
}

async function empresaPessoas(c: Contexto): Promise<Saida> {
  const chamadas: Partial<Record<Fornecedor, number>> = {};
  const fontes: FonteColeta[] = [];
  let hunter: unknown = 'não consultado';
  if (!c.qualificacao.dominioCorporativo) hunter = 'não consultado: e-mail de domínio gratuito';
  else if (pode(c, 'hunter')) {
    c.chamadas.hunter++;
    chamadas.hunter = 1;
    const h = await consultaHunter(c.chaves.hunter, c.email).catch(() => ({ status: 0, dados: null }));
    hunter = h.dados ?? `sem correspondência (HTTP ${h.status})`;
    if (h.dados) fontes.push({ url: 'https://api.hunter.io/v2/people/find', titulo: 'Hunter – enriquecimento pelo e-mail corporativo', tipo: 'api', consultadoEm: agoraIso() });
  }
  const { env, r } = await envelopeDaEtapa(c, 'empresa_pessoas', fontes, { hunter }, MAX_BUSCAS.empresa_pessoas);
  return { envelope: env, uso: usoDe(c, [r]), chamadas };
}

async function simples(c: Contexto, etapa: Etapa, insumos: Record<string, unknown>): Promise<Saida> {
  const { env, r } = await envelopeDaEtapa(c, etapa, [], insumos, MAX_BUSCAS[etapa]);
  return { envelope: env, uso: usoDe(c, [r]), chamadas: {} };
}

const EXECUTA: Record<Etapa, (c: Contexto) => Promise<Saida>> = {
  empresa_digital: empresaDigital,
  empresa_registro: empresaRegistro,
  empresa_pessoas: empresaPessoas,
  empresa_noticias: (c) => simples(c, 'empresa_noticias', {}),
  setor: (c) => simples(c, 'setor', { empresa_registro: c.conteudos.empresa_registro ?? 'sem conteúdo', empresa_digital: c.conteudos.empresa_digital ?? 'sem conteúdo' }),
  mercado: (c) => simples(c, 'mercado', { setor: c.conteudos.setor ?? 'sem conteúdo' }),
};

// Runs one stage and writes its document; never throws (a failed stage does not stop the others).
async function roda(c: Contexto, etapa: Etapa): Promise<void> {
  const doc = c.ref.collection('coleta').doc(etapa);
  const atual = (await doc.get()).data();
  if (atual?.status === 'concluida' && atual.versaoMetodo === c.versao) {
    c.conteudos[etapa] = atual.conteudo;
    return;
  }
  const inicio = Date.now();
  await doc.update({ status: 'executando', iniciadoEm: Timestamp.now() });
  const usoVazio = { chamadasBrasilapi: 0, chamadasApollo: 0, chamadasApify: 0, chamadasHunter: 0 };
  try {
    const s = await EXECUTA[etapa](c);
    c.conteudos[etapa] = s.envelope.conteudo;
    c.totais.tokensEntrada += s.uso.tokensEntrada;
    c.totais.tokensSaida += s.uso.tokensSaida;
    c.totais.buscas += s.uso.buscas;
    c.totais.usd += s.uso.usd;
    await doc.update({
      status: 'concluida',
      ...s.envelope,
      modelo: noEmulador() ? 'simulado' : c.p.modeloColeta,
      uso: {
        tokensEntrada: s.uso.tokensEntrada, tokensSaida: s.uso.tokensSaida, buscas: s.uso.buscas, duracaoMs: Date.now() - inicio,
        chamadasBrasilapi: s.chamadas.brasilapi ?? 0, chamadasApollo: s.chamadas.apollo ?? 0, chamadasApify: s.chamadas.apify ?? 0, chamadasHunter: s.chamadas.hunter ?? 0,
      },
      concluidoEm: Timestamp.now(),
      tentativa: FieldValue.increment(1),
    });
  } catch (e) {
    const mensagem = String((e as Error)?.message ?? e).slice(0, 300);
    logger.warn('coletar: stage failed', { id: c.id, etapa, mensagem });
    await doc.update({
      status: 'falhou', conteudo: {}, fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: `falha: ${mensagem}` },
      modelo: c.p.modeloColeta, uso: { tokensEntrada: 0, tokensSaida: 0, buscas: 0, duracaoMs: Date.now() - inicio, ...usoVazio },
      concluidoEm: Timestamp.now(), tentativa: FieldValue.increment(1),
    });
  }
  const status = (await doc.get()).get('status');
  await c.ref.collection('eventos').add({ em: Timestamp.now(), ator: { tipo: 'ia', id: 'coletar' }, tipo: 'coleta_etapa', detalhe: { etapa, status } });
}

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
      const versao = (await db.doc('config/metodo').get()).get('versao') as string | undefined;
      if (!versao) throw new Error('config/metodo has no published version');
      if (!noEmulador() && !p.modeloColeta) throw new Error('config/pipeline.modeloColeta is empty');

      // Claim: the transaction gives up if another delivery of the event got here first.
      const agora = Timestamp.now();
      let ficou = false;
      await db.runTransaction(async (tx) => {
        const f = (await tx.get(ref)).data();
        const docs = await Promise.all(ETAPAS.map((e) => tx.get(ref.collection('coleta').doc(e))));
        if (!f || f.estado !== 'coletando' || !(f.estadoEm as Timestamp).isEqual(depois.estadoEm as Timestamp)) return;
        ficou = true;
        tx.update(ref, { estadoEm: agora, versaoMetodo: versao });
        docs.forEach((d, i) => {
          const v = d.data();
          if (v?.status === 'concluida' && v.versaoMetodo === versao) return;
          tx.set(d.ref, { etapa: ETAPAS[i], status: 'pendente', versaoMetodo: versao, tentativa: v?.tentativa ?? 0 });
        });
        tx.create(ref.collection('eventos').doc(), { em: agora, ator: { tipo: 'sistema', id: 'coletar' }, tipo: 'coleta_iniciada', detalhe: { versaoMetodo: versao } });
      });
      if (!ficou) return;

      const original = depois.original as Original;
      const normalizado = depois.normalizado as Normalizado;
      const c: Contexto = {
        id, ref, p, versao,
        email: normalizado.email,
        qualificacao: depois.qualificacao ?? {},
        ficha: {
          nome: original.nome, empresa: original.empresa, cargo: original.cargo, rotuloCargo: CARGOS_ROTULO[original.cargo] ?? original.cargo,
          dominioEmail: dominioDe(normalizado.email), site: normalizado.site, mensagem: original.mensagem, lang: original.lang,
        },
        chaves: noEmulador()
          ? { claude: '', apollo: '', apify: '', hunter: '' }
          : { claude: CLAUDE_API_KEY.value(), apollo: APOLLO_API_KEY.value(), apify: APIFY_TOKEN.value(), hunter: HUNTER_API_KEY.value() },
        buscasRestantes: Math.max(0, p.tetoBuscasPorFicha - Number(depois.custo?.buscas ?? 0)),
        chamadas: { brasilapi: 0, apollo: 0, apify: 0, hunter: 0 },
        conteudos: {},
        site: null,
        totais: { tokensEntrada: 0, tokensSaida: 0, buscas: 0, usd: 0 },
      };

      const digital = roda(c, 'empresa_digital');
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
      logger.info('coletar: done', { id, buscas: t.buscas, usd });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 500);
      logger.error('coletar failed', { id, mensagem });
      await ref.update({ erro: { etapa: 'coletar', mensagem, em: Timestamp.now() } }).catch(() => undefined);
    }
  },
);
