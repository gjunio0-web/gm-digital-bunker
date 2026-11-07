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

// Defaults of config/pipeline (spec 01, section 2 and decision 2). seed.ts writes them once and
// later adds only missing fields; the functions fall back to them when the document or a field is missing.
export const PIPELINE_PADRAO = {
  tetoBuscasPorFicha: 20,
  modeloColeta: '',
  modeloSintese: '',
  modeloRevisor: '',
  autoAnalisar: true,
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
  modeloColeta: string;
  modeloSintese: string;
  modeloRevisor: string;
  autoAnalisar: boolean;
  prazoGuardaDias: number;
  prazoGuardaDiasBreve: number;
  limiteFichasPorEmailPorDia: number;
  limiteFichasPorIpPorHora: number;
  fontes: Record<Fornecedor, Fonte>;
  pesosQualificacao: Pesos;
}

export const DIA_MS = 24 * 60 * 60 * 1000;
