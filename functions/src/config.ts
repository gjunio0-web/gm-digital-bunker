// Single place for constants shared by the functions (spec 01, section 4).
import { defineSecret } from 'firebase-functions/params';

// Region of every function (the Firestore database lives in the same region).
export const REGIAO = 'southamerica-east1';

// Origins allowed to post the form, per Firebase project. A project not listed accepts no origin.
export const ORIGENS_POR_PROJETO: Record<string, readonly string[]> = {
  'gmdb-qualidade': ['https://quality-env--gm-digital-bunker.netlify.app', 'http://localhost:4321'],
  'gmdb-producao': ['https://gmdigitalbunker.com.br'],
};

export const EMAIL_CONTATO = 'contato@gmdigitalbunker.com.br';
export const REMETENTE = `GM Digital Bunker™ <${EMAIL_CONTATO}>`;
export const SITE = 'gmdigitalbunker.com.br';

// Secrets (Secret Manager). CLAUDE_API_KEY is declared for the pipeline functions of later items
// and is not bound to receberFicha.
export const SMTP2GO_API_KEY = defineSecret('SMTP2GO_API_KEY');
export const IP_HASH_SALT = defineSecret('IP_HASH_SALT');
export const CLAUDE_API_KEY = defineSecret('CLAUDE_API_KEY');

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
}

export const DIA_MS = 24 * 60 * 60 * 1000;
