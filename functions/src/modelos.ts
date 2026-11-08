// Model and effort of each stage (spec 02 v0.12, section 0): read from config/pipeline.modelos and
// config/pipeline.esforco, never fixed in code. reparar inherits from the stage that produced the text and
// corrigir from montar_analise when their entries are null. Pure functions.
import type { EtapaModelo, Esforco, Pipeline } from './config.js';
import { ESFORCOS } from './config.js';

const herdeiro = (etapa: EtapaModelo, origem?: EtapaModelo): EtapaModelo | null =>
  etapa === 'reparar' ? origem ?? null : etapa === 'corrigir' ? 'montar_analise' : null;

export function modeloDe(p: Pick<Pipeline, 'modelos'>, etapa: EtapaModelo, origem?: EtapaModelo): string {
  const proprio = p.modelos?.[etapa];
  if (proprio) return proprio;
  const h = herdeiro(etapa, origem);
  return h ? modeloDe(p, h) : '';
}

export function esforcoDe(p: Pick<Pipeline, 'esforco'>, etapa: EtapaModelo, origem?: EtapaModelo): Esforco {
  const proprio = p.esforco?.[etapa];
  if (proprio) {
    if (!(ESFORCOS as readonly string[]).includes(proprio)) throw new Error(`config/pipeline.esforco.${etapa}: invalid value "${proprio}"`);
    return proprio;
  }
  const h = herdeiro(etapa, origem);
  return h ? esforcoDe(p, h) : 'padrao';
}

// Value of output_config.effort; "padrao" sends nothing (the model default).
const API: Record<Esforco, string | undefined> = { baixo: 'low', medio: 'medium', alto: 'high', padrao: undefined };
export const esforcoApi = (e: Esforco): string | undefined => API[e];

// Key of the synthesis design in metricas (spec 01 v0.11, metricas): model and effort of the three synthesis
// calls, so that designs A and C of phase B2 are counted apart. Firestore map keys, no dots.
export function chaveDesenho(chamadas: Partial<Record<'enquadrar' | 'preparar_conversa' | 'montar_analise', { modelo?: string; esforco?: string }>>): string {
  return (['enquadrar', 'preparar_conversa', 'montar_analise'] as const)
    .map((k) => `${String(chamadas[k]?.modelo ?? '?').replace(/^claude-/, '')}_${chamadas[k]?.esforco ?? '?'}`)
    .join('__')
    .replace(/[.\s/]/g, '-');
}
