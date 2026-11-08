// Lead grading (spec 04, sections 2 and 3; spec 01, section 2, field lead): the four axes with their
// items and marks, quadrant, grade, modifiers, destination, response deadline in business days and the
// short-retention rule. Pure functions: no Firebase imports, so they can be unit tested. The same
// calculation serves both moments; in "triagem" the items that depend on stages not yet run are 0
// and carry their mark. Decisions of Gon of 6/11/2026 for the cases the spec 04 table does not cover
// are marked "decision 6/11"; spec 04 v0.12 records them.

export type Momento = 'triagem' | 'analise';
export type Quadrante = 'priorizar' | 'qualificar' | 'nutrir' | 'declinar';
export type Grau = 'A' | 'B' | 'C' | 'D';
export type GrauConfianca = 'alta' | 'media' | 'baixa';
export type Destino = 'convidar' | 'verificar_aderencia' | 'nutrir' | 'encerrar';
export type Marca = null | 'cargo_nao_verificado' | 'noticias_nao_coletadas' | 'so_na_analise';
export type CategoriaTecnologia = 'enxuta' | 'sem_sinal' | 'equipe_propria' | 'executivo';
export type PorteLegal = 'ME' | 'EPP' | 'demais';

// Weights of config/pipeline.pesosQualificacao (spec 04, sections 2.1 to 2.4), version "2": spec 04 v0.15,
// "outro" no longer deducts (decision of Gon, 8/11/2026).
export const PESOS_PADRAO = {
  versao: '2',
  limiarQuadrante: 15,
  cortesFuncionarios: { medio: 500, grande: 1000 },
  aderencia: {
    porte: {
      demaisAte500: 18,
      eppComCrescimento: 14,
      indeterminado: 9,
      eppSemCrescimento: 8,
      demais501a1000: 6,
      microempresa: 3,
      acimaDe1000: 0,
      pessoaFisica: 0,
      nenhumaEmpresa: 0,
    },
    tecnologia: { enxuta: 12, sem_sinal: 8, equipe_propria: 5, executivo: 0 },
  },
  decisao: {
    nivelCargo: { decisor: 12, intermediario: 4, outro: 0 },
    cargoConfirmado: { true: 4, indeterminado: 2, false: 0 },
    dominioCorporativo: 4,
  },
  intencao: {
    mensagem: 8,
    problemaOuFerramenta: { problema: 8, ambos: 8, ferramenta: 3, nenhum: 0 },
    gatilho: 6,
    noticia: 4,
  },
  clareza: {
    porta: { unicaComDoisSinais: 10, combinacao: 7, umSinal: 4, indeterminada: 0 },
    hipotese: 5,
    direcao: 5,
  },
  // Origin pages with points (spec 01, config/pipeline; spec 04, 2.1): paths already normalized, "*" for
  // one or more segments; pages not listed score 0. English paths are the site's real routes.
  paginasOrigem: [
    { pagina: 'servicos/conselho-de-ia', pontos: 4 },
    { pagina: 'servicos/estrategia-e-plataforma-digital-com-ia', pontos: 4 },
    { pagina: 'servicos/workshop-quando-e-melhor-com-ia', pontos: 4 },
    { pagina: 'en/services/ai-advisory', pontos: 4 },
    { pagina: 'en/services/ai-strategy-and-digital-platform', pontos: 4 },
    { pagina: 'en/services/when-its-better-with-ai-workshop', pontos: 4 },
    { pagina: 'casos/*', pontos: 3 },
    { pagina: 'en/cases/*', pontos: 3 },
    { pagina: 'metodo', pontos: 1 },
    { pagina: 'metodo/livro', pontos: 1 },
    { pagina: 'sobre', pontos: 1 },
    { pagina: 'en/method', pontos: 1 },
    { pagina: 'en/method/book', pontos: 1 },
    { pagina: 'en/about', pontos: 1 },
  ] as { pagina: string; pontos: number }[],
  deducoes: { curioso_sem_orcamento: 8, expectativa_de_revenda: 8, teto: 16 },
  graus: { A: { minimo: 70, prazoDiasUteis: 2 }, B: { minimo: 50, prazoDiasUteis: 3 }, C: { minimo: 30, prazoDiasUteis: 4 }, D: { minimo: 0, prazoDiasUteis: 5 } },
};
export type Pesos = typeof PESOS_PADRAO;

export interface Parcela {
  criterio: string;
  valor: string | number | boolean | null;
  pontos: number;
  marca: Marca;
}

export interface EntradaGraduacao {
  momento: Momento;
  spam: boolean;
  tipoContato: string | null;
  // Size: legal size from the confirmed CNPJ (null when not confirmed), Apollo head count, and whether
  // any company was identified at all (site read, Apollo match, confirmed CNPJ).
  porteLegal: PorteLegal | null;
  cnpjConfirmado: boolean;
  funcionarios: number | null;
  // Source of the head count (spec 04 v0.10): Apollo; in the analysis, the Pessoas stage when Apollo has none.
  fonteFuncionarios: 'apollo' | 'pessoas' | null;
  siteLido: boolean;
  apolloEncontrado: boolean;
  sinalCrescimento: boolean;
  tecnologia: { categoria: CategoriaTecnologia; evidencia: string } | null;
  nivelCargo: 'decisor' | 'intermediario' | 'outro';
  cargoConfirmado: 'true' | 'false' | 'indeterminado' | null; // null in triagem (stage not run)
  dominioCorporativo: boolean;
  temMensagem: boolean;
  problemaOuFerramenta: 'problema' | 'ferramenta' | 'ambos' | 'nenhum' | null;
  gatilho: boolean;
  paginaOrigem: string | null;
  noticia: boolean | null; // null in triagem
  porta: { porta: string; sinais: number } | null;
  hipotese: boolean | null; // null in triagem
  direcao: boolean | null; // null in triagem
  riscos: string[];
  escopo: 'aprovado' | 'ressalva' | 'barrado' | null;
  confiancaBlocos: { registro: GrauConfianca | null; digital: GrauConfianca | null; pessoas: GrauConfianca | null };
  comPendencias: boolean;
}

export interface Lead {
  momento: Momento;
  quadrante: Quadrante;
  grau: Grau;
  pontos: number;
  eixos: {
    aderencia: { pontos: number; maximo: number; porte: { categoria: string; pontos: number; fonteFuncionarios: 'apollo' | 'pessoas' | null }; tecnologia: { categoria: string; pontos: number; evidencia: string | null } };
    decisao: { pontos: number; maximo: number; parcelas: Parcela[] };
    intencao: { pontos: number; maximo: number; parcelas: Parcela[] };
    clareza: { pontos: number; maximo: number; parcelas: Parcela[] };
  };
  deducoes: { risco: string; pontos: number }[];
  modificadores: { spam: boolean; escopo: 'aprovado' | 'ressalva' | 'barrado' | null; confianca: GrauConfianca; confiancaMotivo: string };
  destino: Destino;
  destinoAlterado: boolean;
  acao: { prazoDiasUteis: number };
  versaoPesos: string;
}

const soma = (ps: Parcela[]) => ps.reduce((t, p) => t + p.pontos, 0);
const max = (o: Record<string, number>) => Math.max(...Object.values(o));

// Aderência, question 1 (spec 04, 2.1, in code). Decisions 6/11: CNPJ not confirmed with Apollo head
// count – up to 500: indeterminate (9), 501 to 1,000: 6, above 1,000: 0; "Demais" without head count: 9;
// no company identified – person or student, or no site read, no Apollo match and no confirmed CNPJ: 0.
export function porte(e: EntradaGraduacao, w: Pesos): { categoria: string; pontos: number } {
  const p = w.aderencia.porte;
  const { medio, grande } = w.cortesFuncionarios;
  if (e.tipoContato === 'pessoa_fisica' || e.tipoContato === 'estudante') return { categoria: 'pessoa_fisica', pontos: p.pessoaFisica };
  if (!e.siteLido && !e.apolloEncontrado && !e.cnpjConfirmado) return { categoria: 'nenhuma_empresa', pontos: p.nenhumaEmpresa };
  const f = e.funcionarios;
  if (f !== null && f > grande) return { categoria: 'acima_de_1000', pontos: p.acimaDe1000 };
  const legal = e.cnpjConfirmado ? e.porteLegal : null;
  if (legal === 'ME') return { categoria: 'microempresa', pontos: p.microempresa };
  if (legal === 'EPP') return e.sinalCrescimento ? { categoria: 'epp_com_crescimento', pontos: p.eppComCrescimento } : { categoria: 'epp_sem_crescimento', pontos: p.eppSemCrescimento };
  if (f !== null && f > medio) return { categoria: 'de_501_a_1000', pontos: p.demais501a1000 };
  if (legal === 'demais' && f !== null) return { categoria: 'demais_ate_500', pontos: p.demaisAte500 };
  return { categoria: 'indeterminado', pontos: p.indeterminado };
}

// Origin page (spec 01, section 2, lead): query and fragment removed, leading and trailing slashes removed,
// lower case; the en/ prefix is kept. "/servicos/conselho-de-ia/" and "servicos/conselho-de-ia" are equal.
export function normalizaPagina(pagina: string | null | undefined): string | null {
  if (typeof pagina !== 'string') return null;
  const p = pagina.split(/[?#]/)[0].trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  return p || null;
}

// Points of a normalized page in the list; "x/*" matches x/ followed by one or more segments.
export function pontosDaPagina(pagina: string | null, lista: Pesos['paginasOrigem']): number {
  if (!pagina) return 0;
  for (const { pagina: item, pontos } of lista) {
    if (item.endsWith('/*') ? pagina.startsWith(item.slice(0, -1)) && pagina.length > item.length - 1 : pagina === item) return pontos;
  }
  return 0;
}

const NOMES_BLOCOS = { registro: 'Registro', digital: 'Presença digital', pessoas: 'Pessoas' } as const;
const juntaNomes = (n: string[]) => (n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`);

// Confidence and its reason (spec 04, section 2.5; spec 01, section 2, recording rules): low without a
// confirmed CNPJ, with legal size "Demais" and no head count from any source, or with two or more low
// blocks; medium with pending issues or exactly one low block; a missing or failed block counts as low.
// The reason that sets the level comes first, the others after it, joined by " · "; "sem ressalvas" when high.
export function confianca(e: EntradaGraduacao): { nivel: GrauConfianca; motivo: string } {
  const chaves = e.momento === 'triagem' ? (['registro', 'digital'] as const) : (['registro', 'digital', 'pessoas'] as const);
  const baixos = chaves.filter((k) => e.confiancaBlocos[k] === 'baixa' || e.confiancaBlocos[k] === null).map((k) => NOMES_BLOCOS[k]);
  const deBaixa: string[] = [];
  const deMedia: string[] = [];
  if (!e.cnpjConfirmado) deBaixa.push('CNPJ não confirmado');
  if (e.cnpjConfirmado && e.porteLegal === 'demais' && e.funcionarios === null) deBaixa.push('porte sem estimativa de funcionários');
  if (baixos.length >= 2) deBaixa.push(`${juntaNomes(baixos)} com confiança baixa`);
  if (e.comPendencias) deMedia.push('análise com pendências');
  if (baixos.length === 1) deMedia.push(`${baixos[0]} com confiança baixa`);
  const motivos = [...deBaixa, ...deMedia];
  return { nivel: deBaixa.length ? 'baixa' : deMedia.length ? 'media' : 'alta', motivo: motivos.length ? motivos.join(' · ') : 'sem ressalvas' };
}

const DESTINOS: Record<Quadrante, Destino> = { priorizar: 'convidar', qualificar: 'verificar_aderencia', nutrir: 'nutrir', declinar: 'encerrar' };

export function gradua(e: EntradaGraduacao, w: Pesos = PESOS_PADRAO): Lead {
  const triagem = e.momento === 'triagem';

  // Axis 1 – Aderência.
  const pt = porte(e, w);
  const semEmpresa = pt.categoria === 'pessoa_fisica' || pt.categoria === 'nenhuma_empresa';
  // Question 2: chosen by the model; a person or no company identified scores 0 (spec 04, 2.1).
  const cat: CategoriaTecnologia = e.tecnologia?.categoria ?? 'sem_sinal';
  const tec = semEmpresa
    ? { categoria: 'sem_empresa', pontos: 0, evidencia: null }
    : { categoria: cat, pontos: w.aderencia.tecnologia[cat], evidencia: e.tecnologia?.evidencia ?? null };
  const aderencia = {
    pontos: pt.pontos + tec.pontos,
    maximo: max(w.aderencia.porte) + max(w.aderencia.tecnologia),
    porte: { ...pt, fonteFuncionarios: e.funcionarios === null ? null : e.fonteFuncionarios },
    tecnologia: tec,
  };

  // Axis 2 – Decisão.
  const d = w.decisao;
  const decisao: Parcela[] = [
    { criterio: 'nivelCargo', valor: e.nivelCargo, pontos: d.nivelCargo[e.nivelCargo], marca: null },
    e.cargoConfirmado === null
      ? { criterio: 'cargoConfirmado', valor: null, pontos: 0, marca: 'cargo_nao_verificado' }
      : { criterio: 'cargoConfirmado', valor: e.cargoConfirmado, pontos: d.cargoConfirmado[e.cargoConfirmado], marca: null },
    { criterio: 'dominioCorporativo', valor: e.dominioCorporativo, pontos: e.dominioCorporativo ? d.dominioCorporativo : 0, marca: null },
  ];

  // Axis 3 – Intenção.
  const i = w.intencao;
  const pagina = normalizaPagina(e.paginaOrigem);
  const intencao: Parcela[] = [
    { criterio: 'mensagem', valor: e.temMensagem, pontos: e.temMensagem ? i.mensagem : 0, marca: null },
    { criterio: 'problemaOuFerramenta', valor: e.problemaOuFerramenta, pontos: e.problemaOuFerramenta ? i.problemaOuFerramenta[e.problemaOuFerramenta] : 0, marca: null },
    { criterio: 'gatilho', valor: e.gatilho, pontos: e.gatilho ? i.gatilho : 0, marca: null },
    { criterio: 'paginaOrigem', valor: pagina, pontos: pontosDaPagina(pagina, w.paginasOrigem), marca: null },
    e.noticia === null
      ? { criterio: 'noticia', valor: null, pontos: 0, marca: 'noticias_nao_coletadas' }
      : { criterio: 'noticia', valor: e.noticia, pontos: e.noticia ? i.noticia : 0, marca: null },
  ];

  // Axis 4 – Clareza.
  const c = w.clareza;
  const porta = e.porta?.porta ?? 'indeterminada';
  const pontosPorta =
    porta === 'indeterminada' ? c.porta.indeterminada : porta === 'combinacao' ? c.porta.combinacao : (e.porta?.sinais ?? 0) >= 2 ? c.porta.unicaComDoisSinais : c.porta.umSinal;
  const clareza: Parcela[] = [
    { criterio: 'porta', valor: porta, pontos: pontosPorta, marca: null },
    e.hipotese === null ? { criterio: 'hipotese', valor: null, pontos: 0, marca: 'so_na_analise' } : { criterio: 'hipotese', valor: e.hipotese, pontos: e.hipotese ? c.hipotese : 0, marca: null },
    e.direcao === null ? { criterio: 'direcao', valor: null, pontos: 0, marca: 'so_na_analise' } : { criterio: 'direcao', valor: e.direcao, pontos: e.direcao ? c.direcao : 0, marca: null },
  ];

  // Deductions (analysis only, spec 04 v0.15, 2.2): only the risks no axis already captures, with origin ficha
  // or coleta, with a ceiling; "outro" never deducts, whatever weight a stored configuration still has.
  const deducoes: { risco: string; pontos: number }[] = [];
  if (!triagem) {
    let total = 0;
    for (const r of e.riscos) {
      if (r === 'outro') continue;
      const v = (w.deducoes as Record<string, number>)[r];
      if (!v || r === 'teto' || total >= w.deducoes.teto) continue;
      const aplicado = Math.min(v, w.deducoes.teto - total);
      total += aplicado;
      deducoes.push({ risco: r, pontos: -aplicado });
    }
  }

  const eixos = {
    aderencia,
    decisao: { pontos: soma(decisao), maximo: max(d.nivelCargo) + max(d.cargoConfirmado) + d.dominioCorporativo, parcelas: decisao },
    intencao: {
      pontos: soma(intencao),
      maximo: i.mensagem + max(i.problemaOuFerramenta) + i.gatilho + Math.max(0, ...w.paginasOrigem.map((x) => x.pontos)) + i.noticia,
      parcelas: intencao,
    },
    clareza: { pontos: soma(clareza), maximo: max(c.porta) + c.hipotese + c.direcao, parcelas: clareza },
  };
  const bruto = eixos.aderencia.pontos + eixos.decisao.pontos + eixos.intencao.pontos + eixos.clareza.pontos + deducoes.reduce((t, x) => t + x.pontos, 0);
  const pontos = Math.max(0, Math.min(100, bruto));

  const altaAderencia = eixos.aderencia.pontos >= w.limiarQuadrante;
  const altaIntencao = eixos.intencao.pontos >= w.limiarQuadrante;
  const quadrante: Quadrante = altaAderencia ? (altaIntencao ? 'priorizar' : 'nutrir') : altaIntencao ? 'qualificar' : 'declinar';

  let grau: Grau = pontos >= w.graus.A.minimo ? 'A' : pontos >= w.graus.B.minimo ? 'B' : pontos >= w.graus.C.minimo ? 'C' : 'D';
  // Scope modifier (analysis only): barred caps at D, with reservation caps at B.
  const escopo = triagem ? null : e.escopo;
  if (escopo === 'barrado') grau = 'D';
  else if (escopo === 'ressalva' && grau === 'A') grau = 'B';

  const conf = confianca(e);
  return {
    momento: e.momento,
    quadrante,
    grau,
    pontos,
    eixos,
    deducoes,
    modificadores: { spam: e.spam, escopo, confianca: conf.nivel, confiancaMotivo: conf.motivo },
    destino: DESTINOS[quadrante],
    destinoAlterado: false,
    acao: { prazoDiasUteis: w.graus[grau].prazoDiasUteis },
    versaoPesos: w.versao,
  };
}

// Short retention (spec 04, section 5): spam, Declinar in triagem, and analysed fichas with grade D.
export function guardaCurta(l: Lead): boolean {
  return l.modificadores.spam || (l.momento === 'triagem' ? l.quadrante === 'declinar' : l.grau === 'D');
}

// State after triagem (spec 01, section 3).
export function proximoEstado(l: Lead, autoAnalisar: boolean): 'descartada' | 'resposta_breve' | 'coletando' | 'qualificada' {
  if (l.modificadores.spam) return 'descartada';
  if (l.quadrante === 'declinar') return 'resposta_breve';
  return autoAnalisar ? 'coletando' : 'qualificada';
}

// --- Business days (decision 6/11): Monday to Friday, without the national holidays – fixed ones and
// Carnival (Monday and Tuesday), Good Friday and Corpus Christi, from the Easter date. Dates in São Paulo
// time (UTC-3, no daylight saving time since 2019).

const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

// Easter Sunday (anonymous Gregorian algorithm), as UTC midnight.
export function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const DIA_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function feriados(ano: number): Set<string> {
  const p = pascoa(ano).getTime();
  const moveis = [-48, -47, -2, 60].map((n) => iso(new Date(p + n * DIA_MS)));
  return new Set([...FIXOS.map((md) => `${ano}-${md}`), ...moveis]);
}

export function diaUtil(d: Date): boolean {
  const s = d.getUTCDay();
  return s !== 0 && s !== 6 && !feriados(d.getUTCFullYear()).has(iso(d));
}

// End of the n-th business day after the São Paulo date of `inicio` (23:59:59 local time).
export function prazoEmDiasUteis(inicio: Date, n: number): Date {
  const local = new Date(inicio.getTime() - 3 * 3600_000);
  let d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  for (let contados = 0; contados < n; ) {
    d = new Date(d.getTime() + DIA_MS);
    if (diaUtil(d)) contados++;
  }
  return new Date(d.getTime() + DIA_MS - 1000 + 3 * 3600_000);
}

// Deadline of the triagem (decision 6/11): from recebidaEm for fichas that do not go to analysis and
// get a reply (resposta_breve); none for spam (no reply) and for fichas going to analysis ("prazo após
// a análise", set when the analysis is ready).
export function prazoDaTriagem(l: Lead, recebidaEm: Date): Date | null {
  if (l.modificadores.spam || l.quadrante !== 'declinar') return null;
  return prazoEmDiasUteis(recebidaEm, l.acao.prazoDiasUteis);
}

// Deadline of an analysed ficha (spec 01, section 2, prazoEm): from the moment the analysis is ready,
// recorded at the end of verificar (phase B); none for spam.
export function prazoDaAnalise(l: Lead, prontaEm: Date): Date | null {
  if (l.modificadores.spam) return null;
  return prazoEmDiasUteis(prontaEm, l.acao.prazoDiasUteis);
}

// Legal size from the BrasilAPI "porte" text.
export function porteLegalDe(porte: unknown): PorteLegal | null {
  const p = String(porte ?? '').toUpperCase();
  if (p.includes('MICRO')) return 'ME';
  if (p.includes('PEQUENO') || p === 'EPP') return 'EPP';
  if (p.includes('DEMAIS')) return 'demais';
  return null;
}

// --- Inputs of the triagem from the stored documents (spec 04, section 2.1) ---------------------

type Doc = Record<string, any> | undefined;
const grauDoBloco = (d: Doc): GrauConfianca | null => (d?.status === 'concluida' ? (d.confianca?.grau ?? null) : d ? 'baixa' : null);

// Legal size of the chosen CNPJ: the BrasilAPI record the code stored, else the model's field.
export function porteDoRegistro(registro: Doc): PorteLegal | null {
  const escolhido = registro?.conteudo?.escolhido?.cnpj ? String(registro.conteudo.escolhido.cnpj).replace(/\D/g, '') : null;
  const doCodigo = (registro?.insumosCodigo?.registros as { cnpj: string; porte: string | null }[] | undefined)?.find((r) => r.cnpj === escolhido);
  const doModelo = registro?.conteudo?.escolhido?.porteLegal;
  return porteLegalDe(doCodigo?.porte ?? null) ?? (doModelo === 'ME' || doModelo === 'EPP' || doModelo === 'demais' ? doModelo : null);
}

// Head count used for the size (spec 04, 2.1; spec 01, fonteFuncionarios): the maximo of Apollo first;
// only in the analysis, the maximo of the Pessoas stage when Apollo has none.
export function estimativaFuncionarios(digital: Doc, pessoas: Doc, momento: Momento): { funcionarios: number | null; fonteFuncionarios: 'apollo' | 'pessoas' | null } {
  const fe = digital?.conteudo?.apollo?.funcionariosEstimados;
  // Documents written before the normalization keep the raw Apollo number in insumosCodigo.
  const apollo = fe && typeof fe === 'object' ? numero(fe.maximo) : numero(digital?.insumosCodigo?.apolloFuncionarios);
  if (apollo !== null) return { funcionarios: apollo, fonteFuncionarios: 'apollo' };
  const doPessoas = momento === 'analise' && pessoas?.status === 'concluida' ? numero(pessoas.conteudo?.empresa?.funcionariosEstimados?.maximo) : null;
  if (doPessoas !== null) return { funcionarios: doPessoas, fonteFuncionarios: 'pessoas' };
  return { funcionarios: null, fonteFuncionarios: null };
}
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Site read (spec 01, coleta/empresa_digital.paginasLidas): at least one page delivered to the model;
// documents without the field fall back to the code flag of the phase A.
export const siteLido = (digital: Doc): boolean =>
  Array.isArray(digital?.paginasLidas) ? digital.paginasLidas.length > 0 : digital?.insumosCodigo?.siteLido === true;

export function entradaTriagem(ficha: Record<string, any>, digital: Doc, registro: Doc): EntradaGraduacao {
  const q = ficha.qualificacao ?? {};
  const cm = q.classificacaoMensagem ?? {};
  const cd = digital?.insumosCodigo ?? {};
  const cnpjConfirmado = registro?.status === 'concluida' && registro.conteudo?.confirmado === true;
  return {
    momento: 'triagem',
    spam: q.decisao === 'descartar',
    tipoContato: cm.tipoContato ?? null,
    porteLegal: cnpjConfirmado ? porteDoRegistro(registro) : null,
    cnpjConfirmado,
    // Triagem: only the Apollo head count (spec 04, 2.1).
    ...estimativaFuncionarios(digital, undefined, 'triagem'),
    siteLido: siteLido(digital),
    apolloEncontrado: cd.apolloEncontrado === true,
    // vagasNoSite.ha = true (spec 02 v0.9, 2.2; spec 04, 2.1); the model may write it as text.
    sinalCrescimento: digital?.conteudo?.vagasNoSite?.ha === true || digital?.conteudo?.vagasNoSite?.ha === 'true',
    tecnologia: q.estruturaTecnologia ?? null,
    nivelCargo: q.nivelCargo ?? 'outro',
    cargoConfirmado: null,
    dominioCorporativo: q.dominioCorporativo === true,
    temMensagem: q.temMensagem === true,
    problemaOuFerramenta: cm.falaDeProblemaOuFerramenta ?? null,
    gatilho: Boolean(cm.gatilho),
    paginaOrigem: ficha.origem?.pagina ?? null,
    noticia: null,
    porta: q.portaIndicada ? { porta: q.portaIndicada.porta, sinais: (q.portaIndicada.sinais ?? []).length } : null,
    hipotese: null,
    direcao: null,
    riscos: [],
    escopo: null,
    confiancaBlocos: { registro: grauDoBloco(registro), digital: grauDoBloco(digital), pessoas: null },
    comPendencias: false,
  };
}

// --- Inputs of the analysis (spec 04, sections 1 and 2; spec 02, 3.1) ------------------------------------

// News of the last 12 months about expansion, fundraising or product (axis 3), counted only with a
// date (AAAA-MM) within 12 months of the analysis; undated items are not counted.
export function noticiaRecente(noticias: Doc, momento: Date): boolean | null {
  if (noticias?.status !== 'concluida') return null;
  const itens = (noticias.conteudo?.itens ?? []) as { data?: string | null; tema?: string }[];
  const limite = new Date(Date.UTC(momento.getUTCFullYear() - 1, momento.getUTCMonth(), 1));
  return itens.some((i) => {
    if (!['expansao', 'captacao', 'produto'].includes(String(i?.tema))) return false;
    const m = /^(\d{4})-(\d{2})/.exec(String(i?.data ?? ''));
    return m !== null && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) >= limite;
  });
}

const vagasAbertas = (digital: Doc, pessoas: Doc) =>
  digital?.conteudo?.vagasNoSite?.ha === true || digital?.conteudo?.vagasNoSite?.ha === 'true' ||
  (pessoas?.status === 'concluida' && Array.isArray(pessoas.conteudo?.empresa?.vagasAbertas) && pessoas.conteudo.empresa.vagasAbertas.length > 0);

export interface EnquadramentoGraduacao {
  estruturaTecnologia: { categoria: CategoriaTecnologia; evidencia: string };
  escopo: { resultado: 'aprovado' | 'ressalva' | 'barrado' };
  porta: { provavel: string; sinais: string[] };
  hipotesesDeAlavanca: { sinal?: string }[];
  riscosDoLead: { risco: string; origem?: string }[];
  leituraDoPotencial: { direcao: string; confianca?: string };
}

// Analysis moment: everything of the triagem plus the remaining stages and enquadrar. The growth signal
// is news of expansion, fundraising or launch in the last 12 months, or open jobs (site or Pessoas stage).
export function entradaAnalise(
  ficha: Record<string, any>,
  docs: { empresa_digital?: Doc; empresa_registro?: Doc; empresa_pessoas?: Doc; empresa_noticias?: Doc },
  enq: EnquadramentoGraduacao,
  momento: Date,
  comPendencias = false,
): EntradaGraduacao {
  const { empresa_digital: digital, empresa_registro: registro, empresa_pessoas: pessoas, empresa_noticias: noticias } = docs;
  const base = entradaTriagem(ficha, digital, registro);
  const coincide = pessoas?.status === 'concluida' ? pessoas.conteudo?.signatario?.coincideComFicha : undefined;
  const cargoConfirmado = coincide === true || coincide === 'true' ? 'true' : coincide === false || coincide === 'false' ? 'false' : coincide === 'indeterminado' ? 'indeterminado' : null;
  const noticia = noticiaRecente(noticias, momento);
  return {
    ...base,
    momento: 'analise',
    ...estimativaFuncionarios(digital, pessoas, 'analise'),
    sinalCrescimento: noticia === true || vagasAbertas(digital, pessoas),
    tecnologia: { categoria: enq.estruturaTecnologia.categoria, evidencia: enq.estruturaTecnologia.evidencia },
    cargoConfirmado,
    noticia,
    porta: { porta: enq.porta.provavel, sinais: enq.porta.sinais.length },
    hipotese: enq.hipotesesDeAlavanca.some((h) => typeof h.sinal === 'string' && h.sinal.trim() !== ''),
    // Spec 04 v0.15, 2.1, axis 4: the direction scores only with medium or high confidence.
    direcao: enq.leituraDoPotencial.direcao !== 'indeterminado' && ['media', 'alta'].includes(enq.leituraDoPotencial.confianca ?? ''),
    // Spec 04 v0.15, 2.2: only risks with origin ficha or coleta deduct.
    riscos: enq.riscosDoLead.filter((r) => r.origem === 'ficha' || r.origem === 'coleta').map((r) => r.risco),
    escopo: enq.escopo.resultado,
    confiancaBlocos: { registro: grauDoBloco(registro), digital: grauDoBloco(digital), pessoas: grauDoBloco(pessoas) },
    comPendencias,
  };
}
