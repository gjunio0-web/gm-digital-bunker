// Stage engine shared by the coleta mínima (coletarMinima) and the rest of the collection (coletar):
// context, provider caps, search budget, the model call with source verification, the six stages and
// the per-stage document write (spec 01, coleta/{etapa}; spec 02, section 2; spec 03).
// Facts the code itself obtained (site read, Apollo head count, BrasilAPI size, Instagram link) are kept
// in insumosCodigo of the stage document, so graduar and later runs read them without the model.
import { logger } from 'firebase-functions';
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import type { Fornecedor, Pipeline } from '../config.js';
import { leMetodo } from '../metodo.js';
import { noEmulador } from '../claude.js';
import { custoDe } from '../custo.js';
import { chamaColeta, chaveUrl, ErroColeta, type RespostaColeta } from './claudeColeta.js';
import { formatoInvalido, normalizaEnvelope, type Envelope, type FonteColeta } from './envelope.js';
import { CHAVES, INSTRUCAO_CANDIDATOS, LIMITES_DA_ETAPA, MAX_BUSCAS, MAX_LEITURAS, METODO_DA_ETAPA, mensagemDaEtapa, type BlocoContexto, type DadosFicha, type Etapa } from './etapas.js';
import { leSite, type LeituraSite } from './site.js';
import { cnpjValido, consultaBrasilApi, type RegistroBrasilApi } from './cnpj.js';
import { consultaApify, consultaApollo, consultaHunter, type Instagram } from './fornecedores.js';
import type { SinaisIniciais } from '../qualificacao.js';
import { normalizaFuncionarios } from './funcionarios.js';

export interface Contexto {
  id: string;
  ref: DocumentReference;
  ficha: DadosFicha;
  email: string;
  sinais: SinaisIniciais;
  contexto: BlocoContexto;
  p: Pipeline;
  versao: string;
  chaves: { claude: string; apollo: string; apify: string; hunter: string };
  // Apify is out of the coleta mínima (spec 04, section 1).
  apify: boolean;
  // Stages this run executes; the others are only read.
  aRodar: Set<Etapa>;
  buscasRestantes: number;
  chamadas: Record<Fornecedor, number>;
  conteudos: Partial<Record<Etapa, Record<string, unknown>>>;
  codigo: Partial<Record<Etapa, Record<string, unknown>>>;
  site: LeituraSite | null;
  // URLs of the site pages the code delivered to the model in this run (spec 01, paginasLidas).
  paginasLidas?: string[];
  totais: { tokensEntrada: number; tokensSaida: number; buscas: number; usd: number };
}

// What a stage consumed, kept even when it fails: model calls (complete or partial) and provider calls.
interface Rastro {
  rs: RespostaColeta[];
  chamadas: Partial<Record<Fornecedor, number>>;
}

const registraChamada = (c: Contexto, t: Rastro, f: Fornecedor) => {
  c.chamadas[f]++;
  t.chamadas[f] = (t.chamadas[f] ?? 0) + 1;
};

const agoraIso = () => new Date().toISOString();

// Provider allowed for this ficha: active in config, key present (BrasilAPI needs none), under its cap.
function pode(c: Contexto, f: Fornecedor): boolean {
  const chave = { brasilapi: 'x', apollo: c.chaves.apollo, apify: c.chaves.apify, hunter: c.chaves.hunter }[f];
  if (f === 'apify' && !c.apify) return false;
  return !noEmulador() && c.p.fontes[f].ativo && Boolean(chave) && c.chamadas[f] < c.p.fontes[f].maxChamadasPorFicha;
}

// One model call of a stage, with the search budget reserved and refunded.
async function chama(c: Contexto, t: Rastro, etapa: Etapa, usuario: string, maxBuscas: number, valida: (j: unknown) => string | null): Promise<RespostaColeta> {
  const reserva = Math.max(0, Math.min(maxBuscas, c.buscasRestantes));
  c.buscasRestantes -= reserva;
  try {
    const met = METODO_DA_ETAPA[etapa];
    const metodo = met ? (await leMetodo(met)).blocos.map((b) => ({ nome: b.nome, texto: b.texto })) : [];
    const r = await chamaColeta({ chave: c.chaves.claude, modelo: c.p.modeloColeta, metodo, usuario, maxBuscas: reserva, maxLeituras: MAX_LEITURAS, valida, ...LIMITES_DA_ETAPA[etapa] });
    c.buscasRestantes += reserva - Math.min(reserva, r.buscas);
    t.rs.push(r);
    return r;
  } catch (e) {
    const gastas = e instanceof ErroColeta ? Math.min(reserva, e.parcial.buscas) : 0;
    if (e instanceof ErroColeta) t.rs.push(e.parcial);
    c.buscasRestantes += reserva - gastas;
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
async function envelopeDaEtapa(c: Contexto, t: Rastro, etapa: Etapa, fontes: FonteColeta[], insumos: Record<string, unknown>, maxBuscas: number, extraVerificadas: string[] = []): Promise<Envelope> {
  const usuario = mensagemDaEtapa(etapa, c.ficha, c.contexto, fontes, insumos);
  let r: RespostaColeta;
  if (noEmulador()) {
    r = simula(etapa, fontes);
    // Simulated registry: the simulated CNPJ counts as confirmed (see simulaCodigo).
    const reg = (c.codigo.empresa_registro?.registros as { cnpj: string }[] | undefined)?.[0];
    if (etapa === 'empresa_registro' && reg) Object.assign((r.json as any).conteudo, { confirmado: true, escolhido: { cnpj: reg.cnpj, porteLegal: 'demais' } });
    t.rs.push(r);
  } else r = await chama(c, t, etapa, usuario, maxBuscas, (j) => formatoInvalido(j, CHAVES[etapa]));
  const verificadas = new Set([...fontes.map((f) => chaveUrl(f.url)), ...extraVerificadas.map(chaveUrl), ...r.urlsConsultadas]);
  return normalizaEnvelope(r.json as Record<string, any>, verificadas, agoraIso());
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

// Emulator stand-in for the code-side facts of the coleta mínima: a company named "… Média …" gets a
// confirmed medium size (so the emulator test reaches every quadrant); any other gets nothing.
function simulaCodigo(c: Contexto, etapa: Etapa): Record<string, unknown> {
  const media = /média/i.test(c.ficha.empresa);
  if (etapa === 'empresa_digital') return { siteLido: media, apolloEncontrado: media, apolloFuncionarios: media ? 120 : null, instagramDoSite: null, cnpjsNoSite: [], paginaCnpj: null };
  return { registros: media ? [{ cnpj: '11222333000181', porte: 'DEMAIS' }] : [] };
}

// Instagram data from Apify as content, statement and source of empresa_digital.
function instagramDoApify(d: Instagram, origemPerfil: 'site' | 'busca') {
  return { perfil: d.perfil, origemPerfil, seguidores: d.seguidores, publicacoes: d.publicacoes, bio: d.bio, legendasRecentes: d.legendasRecentes };
}

// Profile found by search: Apify only if the profile name cites the company (spec 03, 4.2).
function perfilCitaEmpresa(empresa: string, perfil: string): boolean {
  const palavras = empresa.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter((w) => w.length >= 4);
  const p = perfil.replace(/^@/, '').toLowerCase();
  return palavras.some((w) => p.includes(w));
}

// --- Stages ---------------------------------------------------------------------------------

async function empresaDigital(c: Contexto, t: Rastro): Promise<Envelope> {
  const fontes: FonteColeta[] = [];
  const site = c.sinais.siteResolvido;
  const leitura = site && !noEmulador() ? await leSite(site) : null;
  c.site = leitura;
  c.paginasLidas = noEmulador() ? (/média/i.test(c.ficha.empresa) ? ['https://acme.com.br/'] : []) : (leitura?.paginas ?? []).map((pg) => pg.url);
  for (const pg of leitura?.paginas ?? []) fontes.push({ url: pg.url, titulo: pg.titulo || pg.tipo, tipo: 'pagina', consultadoEm: agoraIso() });

  let apollo: unknown = 'não consultado';
  let apolloFuncionarios: number | null = null;
  let apolloEncontrado = false;
  const dominio = site ? new URL(site).hostname.replace(/^www\./, '') : null;
  if (dominio && pode(c, 'apollo')) {
    registraChamada(c, t, 'apollo');
    const a = await consultaApollo(c.chaves.apollo, dominio).catch(() => ({ status: 0, dados: null }));
    apollo = a.dados ?? `sem correspondência (HTTP ${a.status})`;
    if (a.dados) {
      apolloEncontrado = true;
      apolloFuncionarios = a.dados.funcionariosEstimados;
      fontes.push({ url: `https://api.apollo.io/api/v1/organizations/enrich?domain=${dominio}`, titulo: 'Apollo – enriquecimento de empresa pelo domínio', tipo: 'api', consultadoEm: agoraIso() });
    }
  }

  let instagram: Instagram | null = null;
  if (leitura?.instagram && pode(c, 'apify')) {
    registraChamada(c, t, 'apify');
    instagram = (await consultaApify(c.chaves.apify, leitura.instagram).catch(() => ({ status: 0, dados: null }))).dados;
    if (instagram) fontes.push({ url: `https://www.instagram.com/${instagram.perfil}/`, titulo: 'Instagram da empresa (Apify)', tipo: 'api', consultadoEm: agoraIso() });
  }

  c.codigo.empresa_digital = noEmulador()
    ? simulaCodigo(c, 'empresa_digital')
    : {
        siteLido: Boolean(leitura?.paginas.length),
        apolloEncontrado,
        apolloFuncionarios,
        instagramDoSite: leitura?.instagram ?? null,
        cnpjsNoSite: leitura?.cnpjs ?? [],
        paginaCnpj: leitura?.paginas[0]?.url ?? null,
      };

  const insumos = {
    paginasDoSite: leitura ? leitura.paginas.map((pg, i) => `[fonte ${i}] ${pg.tipo} – ${pg.url}\n${pg.texto}`).join('\n\n') : site ? 'site não lido' : 'sem site',
    falhasDeLeitura: leitura?.falhas.length ? leitura.falhas : undefined,
    tecnologiasDetectadas: leitura?.tecnologias,
    cnpjsNoSite: leitura?.cnpjs,
    apollo,
    instagram: instagram
      ? { ...instagram, origemPerfil: 'site' }
      : leitura?.instagram
        ? `perfil linkado no site: ${leitura.instagram} (${c.apify ? 'sem dados do Apify' : 'dados do Apify só na análise completa'})`
        : 'sem link de Instagram no site',
  };
  const env = await envelopeDaEtapa(c, t, 'empresa_digital', fontes, insumos, MAX_BUSCAS.empresa_digital);

  const ig = env.conteudo.instagram as Record<string, any> | null;
  if (!instagram && ig?.perfil && ig.origemPerfil === 'busca' && pode(c, 'apify') && perfilCitaEmpresa(c.ficha.empresa, String(ig.perfil))) {
    registraChamada(c, t, 'apify');
    const d = (await consultaApify(c.chaves.apify, String(ig.perfil).replace(/^@/, '').toLowerCase()).catch(() => ({ status: 0, dados: null }))).dados;
    if (d) {
      const idx = env.fontes.push({ url: `https://www.instagram.com/${d.perfil}/`, titulo: 'Instagram (Apify), perfil achado por busca', tipo: 'api', consultadoEm: agoraIso() }) - 1;
      env.conteudo.instagram = instagramDoApify(d, 'busca');
      env.afirmacoes.push({ texto: `Perfil de Instagram ${d.perfil}, achado por busca, com dados do Apify (inferência: perfil da empresa).`, tipo: 'inferencia', fonteIdx: [idx] });
    }
  }
  // Apollo head count written by the code as {faixa, minimo, maximo} (spec 02 v0.10, 2.2), not by the model.
  const ap = env.conteudo.apollo && typeof env.conteudo.apollo === 'object' ? (env.conteudo.apollo as Record<string, unknown>) : null;
  if (ap || apolloEncontrado) {
    env.conteudo.apollo = { setorFornecedor: null, localizacao: null, ...(ap ?? {}), funcionariosEstimados: normalizaFuncionarios(noEmulador() ? c.codigo.empresa_digital?.apolloFuncionarios : apolloFuncionarios) };
  }
  return env;
}

async function empresaRegistro(c: Contexto, t: Rastro): Promise<Envelope> {
  const fontes: FonteColeta[] = [];
  const extras: string[] = [];
  // CNPJs of the site: from this run's reading, or from the stored empresa_digital (re-run of registro alone).
  const doSite = c.site ? c.site.cnpjs : ((c.codigo.empresa_digital?.cnpjsNoSite as string[] | undefined) ?? []);
  const paginaSite = c.site ? c.site.paginas[0]?.url ?? '' : String(c.codigo.empresa_digital?.paginaCnpj ?? '');
  let candidatos = doSite.map((cnpj) => ({ cnpj, origem: 'site', url: paginaSite }));
  let buscasPrincipal = MAX_BUSCAS.empresa_registro;

  if (!candidatos.length && !noEmulador()) {
    // Step 1: candidates by web search only; the code checks digits and BrasilAPI before any acceptance.
    const usuario = [
      `<ficha>\nempresa: ${c.ficha.empresa}\nsite: ${c.ficha.site ?? '–'}\ndomínio do e-mail: ${c.ficha.dominioEmail}\n</ficha>`,
      `<insumo nome="empresa_digital">\n${JSON.stringify({ presencaGeografica: c.conteudos.empresa_digital?.presencaGeografica ?? null, apollo: c.conteudos.empresa_digital?.apollo ?? null })}\n</insumo>`,
      INSTRUCAO_CANDIDATOS,
    ].join('\n');
    const r = await chama(c, t, 'empresa_registro', usuario, MAX_BUSCAS.empresa_registro, (j) => (Array.isArray((j as any)?.candidatos) ? null : 'candidatos missing'));
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
    registraChamada(c, t, 'brasilapi');
    const b = await consultaBrasilApi(k.cnpj).catch(() => ({ status: 0, registro: null }));
    if (b.registro) {
      registros.push(b.registro);
      fontes.push({ url: `https://brasilapi.com.br/api/cnpj/v1/${k.cnpj}`, titulo: `BrasilAPI – CNPJ ${k.cnpj}`, tipo: 'api', consultadoEm: agoraIso() });
    } else registros.push({ cnpj: k.cnpj, erro: `HTTP ${b.status}` });
  }
  c.codigo.empresa_registro = noEmulador()
    ? simulaCodigo(c, 'empresa_registro')
    : { registros: registros.filter((r): r is RegistroBrasilApi => !('erro' in r)).map((r) => ({ cnpj: r.cnpj, porte: r.porte })) };

  const insumos = {
    candidatos: candidatos.length ? candidatos : 'nenhum candidato com dígitos válidos',
    registrosBrasilApi: registros.length ? registros : undefined,
    empresaDigital: c.conteudos.empresa_digital ?? 'etapa empresa_digital sem conteúdo',
  };
  return envelopeDaEtapa(c, t, 'empresa_registro', fontes, insumos, buscasPrincipal, extras);
}

async function empresaPessoas(c: Contexto, t: Rastro): Promise<Envelope> {
  const fontes: FonteColeta[] = [];
  let hunter: unknown = 'não consultado';
  if (!c.sinais.dominioCorporativo) hunter = 'não consultado: e-mail de domínio gratuito';
  else if (pode(c, 'hunter')) {
    registraChamada(c, t, 'hunter');
    const h = await consultaHunter(c.chaves.hunter, c.email).catch(() => ({ status: 0, dados: null }));
    hunter = h.dados ?? `sem correspondência (HTTP ${h.status})`;
    if (h.dados) fontes.push({ url: 'https://api.hunter.io/v2/people/find', titulo: 'Hunter – enriquecimento pelo e-mail corporativo', tipo: 'api', consultadoEm: agoraIso() });
  }
  const env = await envelopeDaEtapa(c, t, 'empresa_pessoas', fontes, { hunter }, MAX_BUSCAS.empresa_pessoas);
  // Head count of the stage: faixa and fonte as the model gave them, minimo and maximo by the code (spec 02 v0.10, 2.3).
  const emp = env.conteudo.empresa && typeof env.conteudo.empresa === 'object' ? (env.conteudo.empresa as Record<string, any>) : null;
  if (emp) {
    const fe = emp.funcionariosEstimados && typeof emp.funcionariosEstimados === 'object' ? emp.funcionariosEstimados : { faixa: emp.funcionariosEstimados ?? null };
    emp.funcionariosEstimados = { ...normalizaFuncionarios(fe.faixa), fonte: typeof fe.fonte === 'string' ? fe.fonte : null };
  }
  return env;
}

const simples = (c: Contexto, t: Rastro, etapa: Etapa, insumos: Record<string, unknown>) => envelopeDaEtapa(c, t, etapa, [], insumos, MAX_BUSCAS[etapa]);

const EXECUTA: Record<Etapa, (c: Contexto, t: Rastro) => Promise<Envelope>> = {
  empresa_digital: empresaDigital,
  empresa_registro: empresaRegistro,
  empresa_pessoas: empresaPessoas,
  empresa_noticias: (c, t) => simples(c, t, 'empresa_noticias', {}),
  setor: (c, t) => simples(c, t, 'setor', { empresa_registro: c.conteudos.empresa_registro ?? 'sem conteúdo', empresa_digital: c.conteudos.empresa_digital ?? 'sem conteúdo' }),
  mercado: (c, t) => simples(c, t, 'mercado', { setor: c.conteudos.setor ?? 'sem conteúdo' }),
};

const somaUso = (c: Contexto, u: ReturnType<typeof usoDe>) => {
  c.totais.tokensEntrada += u.tokensEntrada;
  c.totais.tokensSaida += u.tokensSaida;
  c.totais.buscas += u.buscas;
  c.totais.usd += u.usd;
};

// Reads the stored content and code facts of a stage this run does not execute.
async function carrega(c: Contexto, etapa: Etapa): Promise<void> {
  const d = (await c.ref.collection('coleta').doc(etapa).get()).data();
  if (d?.status === 'concluida') c.conteudos[etapa] = d.conteudo;
  if (d?.insumosCodigo) c.codigo[etapa] = d.insumosCodigo;
}

// Runs one stage and writes its document; never throws (a failed stage does not stop the others).
export async function roda(c: Contexto, etapa: Etapa): Promise<void> {
  if (!c.aRodar.has(etapa)) return carrega(c, etapa);
  const doc = c.ref.collection('coleta').doc(etapa);
  const inicio = Date.now();
  await doc.update({ status: 'executando', iniciadoEm: Timestamp.now() });
  const t: Rastro = { rs: [], chamadas: {} };
  let resultado: { status: 'concluida'; envelope: Envelope } | { status: 'falhou'; mensagem: string };
  try {
    resultado = { status: 'concluida', envelope: await EXECUTA[etapa](c, t) };
  } catch (e) {
    resultado = { status: 'falhou', mensagem: String((e as Error)?.message ?? e).slice(0, 300) };
    logger.warn('coleta: stage failed', { id: c.id, etapa, mensagem: resultado.mensagem });
  }
  // Usage counted whether the stage succeeded or not (partial model calls and provider calls included).
  const u = usoDe(c, t.rs);
  somaUso(c, u);
  const uso = {
    tokensEntrada: u.tokensEntrada, tokensSaida: u.tokensSaida, buscas: u.buscas, duracaoMs: Date.now() - inicio,
    chamadasBrasilapi: t.chamadas.brasilapi ?? 0, chamadasApollo: t.chamadas.apollo ?? 0, chamadasApify: t.chamadas.apify ?? 0, chamadasHunter: t.chamadas.hunter ?? 0,
  };
  const modelo = noEmulador() ? 'simulado' : c.p.modeloColeta;
  const insumosCodigo = c.codigo[etapa] ?? null;
  // Pages read: only in empresa_digital, recorded by the code even when the stage fails (empty when none).
  const extra = etapa === 'empresa_digital' ? { paginasLidas: c.paginasLidas ?? [] } : {};
  if (resultado.status === 'concluida') {
    c.conteudos[etapa] = resultado.envelope.conteudo;
    await doc.update({ status: 'concluida', ...resultado.envelope, ...extra, insumosCodigo, modelo, uso, concluidoEm: Timestamp.now(), tentativa: FieldValue.increment(1) });
  } else {
    await doc.update({
      status: 'falhou', conteudo: {}, fontes: [], afirmacoes: [], confianca: { grau: 'baixa', motivo: `falha: ${resultado.mensagem}` },
      ...extra, insumosCodigo, modelo, uso, concluidoEm: Timestamp.now(), tentativa: FieldValue.increment(1),
    });
  }
  await c.ref.collection('eventos').add({ em: Timestamp.now(), ator: { tipo: 'ia', id: 'coletar' }, tipo: 'coleta_etapa', detalhe: { etapa, status: resultado.status } });
}

// First pass of the full collection: completes the Instagram block of empresa_digital with Apify
// (spec 03, 4.2), code only, without a new model call. Profile linked on the site, or found by search
// when its name cites the company. Never throws.
export async function completaInstagram(c: Contexto): Promise<void> {
  const doc = c.ref.collection('coleta').doc('empresa_digital');
  try {
    const d = (await doc.get()).data();
    if (d?.status !== 'concluida') return;
    const ig = (d.conteudo?.instagram ?? null) as Record<string, any> | null;
    const doSite = (d.insumosCodigo?.instagramDoSite as string | null | undefined) ?? null;
    const perfil = doSite ?? (ig?.origemPerfil === 'busca' && ig.perfil && perfilCitaEmpresa(c.ficha.empresa, String(ig.perfil)) ? String(ig.perfil) : null);
    if (!perfil || typeof ig?.seguidores === 'number' || !pode(c, 'apify')) return;
    const t: Rastro = { rs: [], chamadas: {} };
    registraChamada(c, t, 'apify');
    const r = await consultaApify(c.chaves.apify, perfil.replace(/^@/, '').toLowerCase()).catch(() => ({ status: 0, dados: null }));
    const fontes = [...(d.fontes ?? [])];
    const afirmacoes = [...(d.afirmacoes ?? [])];
    const conteudo = { ...d.conteudo };
    if (r.dados) {
      const origem = doSite ? 'site' : 'busca';
      const idx = fontes.push({ url: `https://www.instagram.com/${r.dados.perfil}/`, titulo: `Instagram da empresa (Apify), perfil ${origem === 'site' ? 'linkado no site' : 'achado por busca'}`, tipo: 'api', consultadoEm: agoraIso() }) - 1;
      conteudo.instagram = instagramDoApify(r.dados, origem);
      afirmacoes.push({
        texto: `Perfil de Instagram ${r.dados.perfil}: ${r.dados.seguidores ?? 'número não informado de'} seguidores e ${r.dados.publicacoes ?? 'número não informado de'} publicações (Apify).`,
        tipo: origem === 'site' ? 'fato' : 'inferencia',
        fonteIdx: [idx],
      });
      c.conteudos.empresa_digital = conteudo;
    }
    await doc.update({ conteudo, fontes, afirmacoes, 'uso.chamadasApify': FieldValue.increment(1) });
    await c.ref.collection('eventos').add({ em: Timestamp.now(), ator: { tipo: 'sistema', id: 'coletar' }, tipo: 'coleta_etapa', detalhe: { etapa: 'empresa_digital', parte: 'instagram', status: r.dados ? 'concluida' : `sem dados (HTTP ${r.status})` } });
  } catch (e) {
    logger.warn('coletar: instagram completion failed', { id: c.id, mensagem: String((e as Error)?.message ?? e).slice(0, 300) });
  }
}
