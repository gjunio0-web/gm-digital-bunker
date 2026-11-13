// Rounds of phase B2 (spec/alteracoes-specs-01-02-portoes-correcao.md, section 7), shared by the comparison
// page and the report. A version is classified by its creation time; a correction version (autor.origem
// correcao) takes the round of its base. Times in UTC, from the run logs of 8 and 9/11/2026.
export const FICHAS_B2 = ['p6N6ZaljSCClrxgkRMg0', 'vDUMs6mi9BQmcl0eBZKe', 'DObT8Tr5ERKfCRZ0L6vj', 'PERUGOBEiTWP7kBxeRTz', 'xyE0CrEYLD3geFZBsaDg'];
// Fifth test ficha of spec 02, section 6: its first version came from the form, in the configuration in force.
export const QUINTA = 'xyE0CrEYLD3geFZBsaDg';

const JANELAS = [
  // First round without correction: every correction call failed (compiled grammar too large).
  { rodada: 'R1', de: '2026-11-08T23:12:00Z', ate: '2026-11-08T23:37:00Z' },
  // Diagnosis of the correction failure and the check of the fix (Capal v5 to v8).
  { rodada: 'diagnostico', de: '2026-11-09T00:00:00Z', ate: '2026-11-09T15:30:00Z' },
  // First round with correction, after the fix (commit b39ca61).
  { rodada: 'R1c', de: '2026-11-09T15:52:00Z', ate: '2026-11-09T16:28:00Z' },
  // Round 1 with correction again, after spec 02 v0.13 (fixed section titles and purposes; commit 4aced6e).
  { rodada: 'R1e', de: '2026-11-09T20:11:00Z', ate: '2026-11-09T20:47:00Z' },
  // Round 1 with correction again, after spec 02 v0.15 (section labels, rule bloco_sem_rotulo; commit b47ebd6).
  { rodada: 'R1f', de: '2026-11-10T02:02:00Z', ate: '2026-11-10T02:36:00Z' },
  // Retest of design C after spec 02 v0.16 (GAT Logística and Elite 90 Pro, three rounds per design, repair in
  // Sonnet 5.5; commit f406a14).
  { rodada: 'RT', de: '2026-11-10T21:47:00Z', ate: '2026-11-10T22:38:00Z' },
  // Round 1 with correction again, after spec 02 v0.17 to v0.19 (fixed labels, porta.combinacao, regraNome;
  // commit 0e01ece); repair in the model of the stage that wrote the text.
  { rodada: 'R1g', de: '2026-11-11T19:24:00Z', ate: '2026-11-11T19:36:00Z' },
  // Round 1 with correction after spec 02 v0.20 (number exceptions, reviewer sentence, method files of the
  // reviewer and of the correction; commit 98c59eb). A first try at 15:54 failed on a Cloud Shell credential
  // error before any synthesis.
  { rodada: 'R1h', de: '2026-11-12T16:06:00Z', ate: '2026-11-12T16:17:00Z' },
  // Round 1 with correction after spec 02 v0.21 (name in the greeting, tie-break rule for the technology
  // structure, assistant rule in escopo-limites.md; commit 445b067, method version 445b067). Two tries at 18:16
  // and 18:19 failed on a Cloud Shell credential error before any synthesis.
  { rodada: 'R1i', de: '2026-11-12T18:25:00Z', ate: '2026-11-12T18:36:00Z' },
  // Round 1 with correction after spec 02 v0.22 (definitions of the technology categories in enquadrar; commit
  // dc7c455, method version 445b067).
  { rodada: 'R1j', de: '2026-11-12T20:36:00Z', ate: '2026-11-12T20:52:00Z' },
  // Round 1 with correction after spec 02 v0.23 (number exceptions, official long forms of acronyms,
  // sem_alteracao treatment; commit 7914c02 on verificar, method version 445b067). Deploys from 2026-11-13 00:52
  // to 16:55 failed because a billing spend cap had paused Cloud Run Functions.
  { rodada: 'R1k', de: '2026-11-13T17:18:00Z', ate: '2026-11-13T17:29:00Z' },
  // Last round of phase B2, design A only, after spec 02 v0.24 (numero_sem_fonte as a warning) and v0.25 (coherent
  // correction, no internal terms in the draft); commit f253505 on verificar and sintetizar.
  { rodada: 'R1l', de: '2026-11-13T20:10:00Z', ate: '2026-11-13T20:15:00Z' },
];
// Latest round with correction: the default of the comparison page and the round of the correction measures.
export const RODADA_CORRECAO = 'R1l';

export const ROTULO_RODADA = {
  automatica: 'automática',
  R1: 'rodada 1 sem correção',
  diagnostico: 'diagnóstico',
  R1c: 'rodada 1 com correção',
  R1e: 'rodada 1 com correção, spec 02 v0.13',
  R1f: 'rodada 1 com correção, spec 02 v0.15',
  RT: 'reteste do desenho C, spec 02 v0.16',
  R1g: 'rodada 1 com correção, spec 02 v0.19',
  R1h: 'rodada 1 com correção, spec 02 v0.20',
  R1i: 'rodada 1 com correção, spec 02 v0.21',
  R1j: 'rodada 1 com correção, spec 02 v0.22',
  R1k: 'rodada 1 com correção, spec 02 v0.23',
  R1l: 'rodada final, só desenho A, spec 02 v0.25',
  anterior: 'antes da B2',
};

const ms = (s) => Date.parse(s);
const momento = (v) => (typeof v.criadaEm === 'string' ? Date.parse(v.criadaEm) : v.criadaEm?.toMillis?.() ?? NaN);

// Round of a version; `versoes` are all versions of the ficha, so a correction finds its base.
export function rodadaDe(fichaId, v, versoes) {
  if (v.origem === 'correcao' && v.baseadaEm) {
    const base = versoes.find((x) => x.id === v.baseadaEm);
    if (base) return rodadaDe(fichaId, base, versoes);
  }
  if (fichaId === QUINTA && v.id === 'v1') return 'automatica';
  const t = momento(v);
  return JANELAS.find((j) => t >= ms(j.de) && t < ms(j.ate))?.rodada ?? 'anterior';
}

// Design of a synthesis version: A (Sonnet in the three stages) or C (Haiku in preparar_conversa and
// montar_analise), read from the model of montar_analise.
export function desenhoDe(modelo) {
  const m = String(modelo ?? '');
  return /haiku/.test(m) ? 'C' : /sonnet/.test(m) ? 'A' : '?';
}
