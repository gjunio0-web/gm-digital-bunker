// Initial content of config/precos, written once by seed.ts and by the configuration migration of
// phase 1 (spec 01 v0.11). It is the table that custo.ts held as constants until commit 01ce19d
// (Claude docs, 7/11/2026); the code never prices from here, only from the stored document.
import type { Precos } from './custo.js';

export const PRECOS_INICIAIS: Precos = {
  versao: '1',
  vigenteDesde: '2026-11-07',
  modelos: {
    'claude-haiku-5-5': {
      entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheGravacao: 0.125,
      acimaDe: { tokens: 100_000, preco: { entrada: 0.5, saida: 2.5, cacheLeitura: 0.05, cacheGravacao: 0.625 } },
    },
    'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.1, cacheGravacao: 2.5, acimaDe: null },
  },
  buscaWeb: { porMil: 10 },
};
