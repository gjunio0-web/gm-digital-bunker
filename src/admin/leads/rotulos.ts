// Labels of the ficha detail (spec 05 §5.4; guide v1.3 §5.2.1, tables approved by Gon on 14/11/2026).
// Identifiers are the ones the pipeline writes (functions/src); an identifier missing from a table is shown
// as it comes. Pure data and string functions only – no Firestore and no DOM.

// ---------- Mechanical rules (spec 02, 4.1) ----------
export const REGRA_MECANICA: Record<string, string> = {
  marca_sem_destino: 'marca de fonte sem destino',
  numero_sem_fonte: 'número sem fonte na mesma frase',
  secao_curta: 'seção curta demais',
  cnpj_a_confirmar: 'CNPJ não confirmado sem a ressalva',
  tipografia: 'travessão ou pronome "tu"',
  sigla: 'sigla sem a forma por extenso',
  sigla_extenso_errado: 'forma por extenso errada da sigla',
  termo_vetado: 'termo vetado pelo glossário',
  grau_sem_nome: 'grau da escala sem o nome',
  ordem_datas: 'ordem de datas invertida',
  bloco_sem_rotulo: 'parágrafo sem rótulo no formato',
  rotulo_fora_da_lista: 'rótulo fora da lista da seção',
  dados_pessoais: 'dado pessoal no texto',
  rascunho_longo: 'rascunho acima de 120 palavras',
  rascunho_preco: 'preço no rascunho',
  rascunho_sem_nome: 'rascunho sem o nome do signatário',
  rascunho_horario_concreto: 'horário concreto no rascunho',
};
/** Rule name: regraNome when the pipeline wrote one, else the mechanical table, else the identifier. */
export const nomeRegra = (regra: string | null | undefined, regraNome?: string | null): string =>
  regraNome || (regra ? REGRA_MECANICA[regra] ?? regra : '');

export const PEND_TIPO: Record<string, string> = {
  escopo: 'escopo', estrutura: 'estrutura', lastro: 'lastro', hipotese: 'hipótese', promessa: 'promessa',
  vocabulario: 'vocabulário', tom: 'tom', lastro_interno: 'lastro interno', mecanica: 'mecânica',
};

/** Fixed section titles (spec 02, 3.3) and the other places a finding can point to. */
export const SECAO: Record<string, string> = {
  s0: 's0 Cabeçalho', s1: 's1 Qualificação imediata', s2: 's2 A empresa', s3: 's3 Setor', s4: 's4 Potencial de mercado',
  s5: 's5 Pessoas', s6: 's6 Enquadramento', s7: 's7 Preparação da primeira conversa', s8: 's8 Fontes',
  resumoExecutivo: 'Resumo executivo', rascunhoResposta: 'Rascunho de resposta', conversa: 'Conversa', enquadramento: 'Enquadramento',
};
export const secaoTxt = (s: string | null | undefined): string => (s ? SECAO[s] ?? s : '');
/** Section of a repair, from its location ("secoes.s3.corpo", "rascunhoResposta.corpo", "conversa.perguntas[0].origem"). */
export function secaoDoLocal(local: string | null | undefined): string {
  if (!local) return '';
  const m = /^secoes\.(s\d)\b/.exec(local);
  return secaoTxt(m ? m[1] : local.split(/[.[]/)[0]);
}

export const ETAPA_TEXTO: Record<string, string> = {
  enquadrar: 'Enquadramento', preparar_conversa: 'Preparação da conversa', montar_analise: 'Montagem da análise',
};
export const ETAPA_COLETA: Record<string, string> = {
  empresa_digital: 'Presença digital', empresa_registro: 'Registro', empresa_pessoas: 'Pessoas',
  empresa_noticias: 'Notícias', setor: 'Setor', mercado: 'Mercado',
};

// ---------- Qualification parcels (spec 04, section 7) ----------
export const PORTE: Record<string, string> = {
  demais_ate_500: '"Demais" até 500 funcionários', epp_com_crescimento: 'EPP com sinal de crescimento',
  indeterminado: 'porte indeterminado', epp_sem_crescimento: 'EPP sem sinal de crescimento',
  de_501_a_1000: '501 a 1.000 funcionários', microempresa: 'microempresa', acima_de_1000: 'mais de 1.000 funcionários',
  pessoa_fisica: 'pessoa física ou estudante', nenhuma_empresa: 'nenhuma empresa identificada',
};
export const TECNOLOGIA: Record<string, string> = {
  enxuta: 'tecnologia enxuta', sem_sinal: 'nenhum sinal de tecnologia', equipe_propria: 'equipe de tecnologia própria',
  executivo: 'executivo de tecnologia', sem_empresa: 'sem empresa',
};
export const porteTxt = (categoria: string, fonte: string | null | undefined): string =>
  (PORTE[categoria] ?? categoria) + (fonte === 'pessoas' ? ' (estimativa da etapa Pessoas)' : '');

/** Text of one parcel {criterio, valor, pontos, marca} of the Decisão, Intenção and Clareza axes. */
export function parcelaTxt(p: { criterio: string; valor: unknown; pontos: number; marca: string | null }, combinacao?: string | null): string {
  const v = p.valor;
  switch (p.criterio) {
    case 'nivelCargo': return v === 'decisor' ? 'cargo de decisor' : v === 'intermediario' ? 'cargo intermediário' : 'outro cargo';
    case 'cargoConfirmado':
      if (p.marca === 'cargo_nao_verificado') return 'cargo não verificado';
      return v === 'true' ? 'cargo confirmado' : v === 'false' ? 'cargo divergente' : 'cargo não confirmado';
    case 'dominioCorporativo': return v ? 'domínio corporativo' : 'e-mail de provedor gratuito';
    case 'mensagem': return v ? 'com mensagem' : 'sem mensagem';
    case 'problemaOuFerramenta':
      return v === 'problema' ? 'mensagem com problema' : v === 'ambos' ? 'com problema e ferramenta' : v === 'ferramenta' ? 'só com ferramenta' : 'sem problema nem ferramenta';
    case 'gatilho': return v ? 'gatilho declarado' : 'sem gatilho';
    case 'paginaOrigem': return p.pontos > 0 && typeof v === 'string' ? `página /${v}` : 'página sem pontos';
    case 'noticia':
      if (p.marca === 'noticias_nao_coletadas') return 'notícias não coletadas';
      return v ? 'notícia recente' : 'sem notícia recente';
    case 'porta':
      if (v === 'indeterminada' || v == null) return 'porta indeterminada';
      if (v === 'combinacao') return 'combinação de portas' + (combinacao ? ` – ${combinacao}` : '');
      return p.pontos >= 10 ? 'porta única com dois sinais' : 'porta com um sinal';
    case 'hipotese':
      if (p.marca === 'so_na_analise') return 'hipótese só na análise';
      return v ? 'hipótese de alavanca' : 'sem hipótese';
    case 'direcao':
      if (p.marca === 'so_na_analise') return 'direção do potencial só na análise';
      return v ? 'direção definida' : 'direção indeterminada ou de confiança baixa';
    default: return p.criterio;
  }
}

/** "⟨parcela⟩ → n · ⟨parcela⟩ → +n": the first with its points, the next with a sign; zero without sign. */
export function linhaParcelas(itens: [string, number][]): string {
  return itens.map(([t, n], i) => `${t} → ${i === 0 || n <= 0 ? String(n).replace('-', '−') : '+' + n}`).join(' · ');
}

export const DEDUCAO: Record<string, string> = {
  curioso_sem_orcamento: 'curiosidade sem orçamento', expectativa_de_revenda: 'expectativa de revender',
};

/**
 * Points each criterion can reach only in the analysis, by the weights of version "2" (spec 04 v0.15) – the
 * version the method window describes. Used for the "n na triagem" maximum of each axis.
 */
export const SO_NA_ANALISE: Record<string, number> = { cargoConfirmado: 4, noticia: 4, hipotese: 5, direcao: 5 };
/** Maximum of each Aderência question (weights version "2"). */
export const MAX_PORTE = 18;
export const MAX_TECNOLOGIA = 12;

// ---------- Destination and answer (spec 04, 3.1 and 3.2) ----------
export const DESTINO: Record<string, [string, string]> = {
  convidar: ['Convidar', 'Convite direto para a primeira conversa, com duas opções de horário · dois materiais alinhados à porta provável'],
  verificar_aderencia: ['Verificar a aderência', 'Convite condicionado: uma pergunta que confirme porte e estrutura antes de propor agenda · um material'],
  nutrir: ['Nutrir', 'Agradecimento, um material de entrada (Método, livro ou AI Strategy Hub) e uma pergunta aberta; sem agenda'],
  encerrar: ['Encerrar com cortesia', 'Cortesia; encaminhamento quando couber · nenhum material ou a página Serviços'],
};
export function respostaTxt(destino: string, spam: boolean, escopo: string | null): string {
  const d = DESTINO[destino] ?? [destino, ''];
  if (spam) return 'Nenhuma: modificador spam (sem análise completa e sem resposta)';
  if (escopo === 'barrado') return 'Encaminhamento: o que a prática oferece em vez do pedido (modificador escopo barrado)';
  if (escopo === 'ressalva') return d[1] + ' · resposta restrita à parte do pedido que cabe no escopo (modificador escopo com ressalva)';
  return d[1];
}
export const PRAZO_DIAS = (n: number) => `${n} dia${n === 1 ? '' : 's'} úte${n === 1 ? 'l' : 'is'}`;

export const PORTA: Record<string, string> = {
  projeto: 'Projeto', conselho: 'Conselho', workshop: 'Workshop', combinacao: 'Combinação', nenhuma: 'Nenhuma', indeterminada: 'Nenhuma',
};
export const RETENCAO_MOTIVO: Record<string, string> = {
  teto_diario: 'o teto diário de análises foi atingido', auto_desligada: 'a análise automática está desligada',
};
export const RETENCAO_CURTO: Record<string, string> = { teto_diario: 'teto diário', auto_desligada: 'análise automática desligada' };

// ---------- Technical diagnosis (spec 05 §5.4) ----------
export function avisoTxt(a: string): string {
  const m = /^custo_sem_preco:\s*(.+?)\s*\((.+)\)$/.exec(a);
  if (m) return `Custo não estimado: a tabela de preços não tem o modelo ${m[2]} (chamada ${m[1]}).`;
  const c = /^correcao_falhou:\s*(.+)$/.exec(a);
  return c ? `Correção recusada: ${c[1]}. Nenhuma versão corrigida foi gravada; as pendências acima são as desta versão, sem tratamento.` : a;
}
export const CK_RES: Record<string, string> = { violado: 'Violado', nao_aplicavel: 'Não se aplica', conforme: 'Conforme' };

// ---------- Model names ----------
/** "claude-sonnet-5-5" → "Sonnet 5.5"; anything else as it comes. */
export function modeloTxt(id: string | null | undefined): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id ?? '');
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : String(id ?? '');
}
