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
  // Sonnet 5.5; commit f406a14). The end of the window is provisional until the run finishes.
  { rodada: 'RT', de: '2026-11-10T21:47:00Z', ate: '2026-11-11T03:00:00Z' },
];
// Latest round with correction: the default of the comparison page and the round of the correction measures.
export const RODADA_CORRECAO = 'RT';

export const ROTULO_RODADA = {
  automatica: 'automática',
  R1: 'rodada 1 sem correção',
  diagnostico: 'diagnóstico',
  R1c: 'rodada 1 com correção',
  R1e: 'rodada 1 com correção, spec 02 v0.13',
  R1f: 'rodada 1 com correção, spec 02 v0.15',
  RT: 'reteste do desenho C, spec 02 v0.16',
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
