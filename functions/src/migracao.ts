// Plan of the config/pipeline migration to spec 01 v0.11 (see migrarPipeline.ts). Pure function: an entry
// already filled in modelos or esforco is kept, so running it again changes nothing.
const ANTIGOS = ['modeloColeta', 'modeloSintese', 'modeloRevisor', 'esforcoSintese'] as const;
const ESFORCO_DA_API: Record<string, string> = { low: 'baixo', medium: 'medio', high: 'alto' };
const SINTESE = ['enquadrar', 'preparar_conversa', 'montar_analise'];

type Mapa = Record<string, unknown>;

export function planoMigracao(atual: Mapa, etapas: readonly string[], padrao: { limiarReparo: number; correcaoAtiva: boolean }): { campos: Mapa; antigos: string[] } {
  const s = (k: string) => (typeof atual[k] === 'string' ? (atual[k] as string) : '');
  const modeloInicial: Record<string, string | null> = {
    qualificar: s('modeloColeta'), coleta: s('modeloColeta'),
    enquadrar: s('modeloSintese'), preparar_conversa: s('modeloSintese'), montar_analise: s('modeloSintese'),
    revisor: s('modeloRevisor'), reparar: null, corrigir: null,
  };
  const esforcoSintese = ESFORCO_DA_API[s('esforcoSintese')] ?? 'padrao';
  const esforcoInicial = (e: string): string | null =>
    e === 'reparar' || e === 'corrigir' ? null : SINTESE.includes(e) ? esforcoSintese : e === 'revisor' ? 'baixo' : 'padrao';

  const modelos = (atual.modelos ?? {}) as Mapa;
  const esforco = (atual.esforco ?? {}) as Mapa;
  const campos: Mapa = {};
  for (const e of etapas) {
    if (!modelos[e]) campos[`modelos.${e}`] = e in modeloInicial ? modeloInicial[e] : '';
    if (!esforco[e]) campos[`esforco.${e}`] = esforcoInicial(e);
  }
  if (!('limiarReparo' in atual)) campos.limiarReparo = padrao.limiarReparo;
  if (!('correcaoAtiva' in atual)) campos.correcaoAtiva = padrao.correcaoAtiva;
  // A null entry stays null (reparar and corrigir inherit): not rewritten when already null.
  for (const k of Object.keys(campos)) if (campos[k] === null && k.split('.')[1] in (k.startsWith('modelos.') ? modelos : esforco)) delete campos[k];
  return { campos, antigos: ANTIGOS.filter((k) => k in atual) };
}
