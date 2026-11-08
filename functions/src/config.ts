// Single place for constants shared by the functions (spec 01, section 4).
import { defineSecret } from 'firebase-functions/params';
import { PESOS_PADRAO, type Pesos } from './graduacao.js';

// Region of every function (the Firestore database lives in the same region).
export const REGIAO = 'southamerica-east1';

// Origins allowed to post the form, per Firebase project. A project not listed accepts no origin.
export const ORIGENS_POR_PROJETO: Record<string, readonly string[]> = {
  'gmdb-qualidade': ['https://quality-env--gm-digital-bunker.netlify.app', 'http://localhost:4321'],
  'gmdb-producao': ['https://gmdigitalbunker.com.br'],
};

// Base URL of the admin hub per Firebase project (spec 05, section 2): the ficha link in the second
// e-mail to the administrator is {base}/admin/leads/{fichaId}.
export const URL_BASE_POR_PROJETO: Record<string, string> = {
  'gmdb-qualidade': 'https://quality-env--gm-digital-bunker.netlify.app',
  'gmdb-producao': 'https://gmdigitalbunker.com.br',
};

export const EMAIL_CONTATO = 'contato@gmdigitalbunker.com.br';
export const REMETENTE = `GM Digital Bunker™ <${EMAIL_CONTATO}>`;
export const SITE = 'gmdigitalbunker.com.br';

// Secrets (Secret Manager). CLAUDE_API_KEY is bound to the pipeline functions (coleta mínima onwards),
// never to receberFicha; SMTP2GO_API_KEY to receberFicha and verificar.
export const SMTP2GO_API_KEY = defineSecret('SMTP2GO_API_KEY');
export const IP_HASH_SALT = defineSecret('IP_HASH_SALT');
export const CLAUDE_API_KEY = defineSecret('CLAUDE_API_KEY');
// Enrichment keys (spec 01, section 5; spec 03, section 8.1), bound only to coletar.
export const APOLLO_API_KEY = defineSecret('APOLLO_API_KEY');
export const APIFY_TOKEN = defineSecret('APIFY_TOKEN');
export const HUNTER_API_KEY = defineSecret('HUNTER_API_KEY');

// Enrichment providers of config/pipeline.fontes (spec 01 v0.3, section 2; spec 03, section 7.1).
// A provider without its key in Secret Manager stays inactive without error.
export const FORNECEDORES = ['brasilapi', 'apollo', 'apify', 'hunter'] as const;
export type Fornecedor = (typeof FORNECEDORES)[number];
export interface Fonte {
  ativo: boolean;
  maxChamadasPorFicha: number;
}

// Stages with their own model and effort in config/pipeline (spec 02 v0.12, section 0).
export const ETAPAS_MODELO = ['qualificar', 'coleta', 'enquadrar', 'preparar_conversa', 'montar_analise', 'reparar', 'revisor', 'corrigir'] as const;
export type EtapaModelo = (typeof ETAPAS_MODELO)[number];
export const ESFORCOS = ['baixo', 'medio', 'alto', 'padrao'] as const;
export type Esforco = (typeof ESFORCOS)[number];

// Defaults of config/pipeline (spec 01, section 2 and decision 2). seed.ts writes them once and
// later adds only missing fields; the functions fall back to them when the document or a field is missing.
export const PIPELINE_PADRAO = {
  tetoBuscasPorFicha: 20,
  // Model and effort per stage (spec 02 v0.12, section 0; spec 01 v0.11, config/pipeline). Model IDs
  // are set in Firestore only, never here; null in reparar and corrigir means "inherit": reparar takes
  // the model and effort of the stage that produced the text, corrigir those of montar_analise.
  modelos: {
    qualificar: '', coleta: '', enquadrar: '', preparar_conversa: '', montar_analise: '',
    reparar: null, revisor: '', corrigir: null,
  },
  esforco: {
    qualificar: 'padrao', coleta: 'padrao', enquadrar: 'padrao', preparar_conversa: 'padrao', montar_analise: 'padrao',
    reparar: null, revisor: 'padrao', corrigir: null,
  },
  // Share of change outside the listed excerpts that invalidates a repair (spec 01 v0.11).
  limiarReparo: 0.02,
  correcaoAtiva: true,
  autoAnalisar: true,
  // Phase 6 (decisions of Gon, 8/11/2026): fichas stopped in coletando or sintetizando longer than this are
  // marked with an interruption error by vigiar; at most this many fichas per day (São Paulo) go from the
  // triagem to the analysis, null for no ceiling.
  prazoParadaMin: 30,
  maxAnalisesPorDia: 10 as number | null,
  prazoGuardaDias: 90,
  prazoGuardaDiasBreve: 30,
  limiteFichasPorEmailPorDia: 3,
  limiteFichasPorIpPorHora: 5,
  fontes: {
    brasilapi: { ativo: true, maxChamadasPorFicha: 3 },
    apollo: { ativo: true, maxChamadasPorFicha: 1 },
    apify: { ativo: true, maxChamadasPorFicha: 1 },
    hunter: { ativo: true, maxChamadasPorFicha: 1 },
  },
  // Lead grading weights (spec 04, sections 2.1 to 2.4; spec 01, config/pipeline), versioned.
  pesosQualificacao: PESOS_PADRAO,
} as const;

export interface Pipeline {
  tetoBuscasPorFicha: number;
  modelos: Record<EtapaModelo, string | null>;
  esforco: Record<EtapaModelo, Esforco | null>;
  limiarReparo: number;
  correcaoAtiva: boolean;
  autoAnalisar: boolean;
  prazoParadaMin: number;
  maxAnalisesPorDia: number | null;
  prazoGuardaDias: number;
  prazoGuardaDiasBreve: number;
  limiteFichasPorEmailPorDia: number;
  limiteFichasPorIpPorHora: number;
  fontes: Record<Fornecedor, Fonte>;
  pesosQualificacao: Pesos;
}

export const DIA_MS = 24 * 60 * 60 * 1000;
