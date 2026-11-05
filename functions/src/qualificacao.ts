// qualificar, code part (spec 02, section 1): signals computed without AI and the decision rules.
// Pure functions: no Firebase imports, so they can be unit tested.
import type { Cargo, Normalizado, Original } from './validacao.js';

// Free e-mail providers: first label of the domain, followed only by a common public suffix.
const PROVEDORES = new Set([
  'gmail', 'googlemail', 'hotmail', 'outlook', 'live', 'msn', 'yahoo', 'ymail', 'rocketmail', 'icloud', 'me', 'mac',
  'uol', 'bol', 'terra', 'ig', 'protonmail', 'proton', 'pm', 'zoho', 'gmx', 'aol', 'yandex',
]);
const SUFIXOS = new Set(['com', 'com.br', 'net', 'net.br', 'org', 'me', 'br', 'co', 'co.uk', 'fr', 'de', 'es', 'pt', 'it', 'ca', 'com.ar', 'com.mx', 'io']);

export const CARGOS_DECISORES: readonly Cargo[] = ['owner', 'ceo', 'director'];

export const TIPOS_CONTATO = ['empresa', 'pessoa_fisica', 'fornecedor', 'estudante', 'spam', 'indeterminado'] as const;
export type TipoContato = (typeof TIPOS_CONTATO)[number];
const PROBLEMA_OU_FERRAMENTA = ['problema', 'ferramenta', 'ambos', 'nenhum'] as const;
const IDIOMAS_MENSAGEM = ['pt', 'en', 'outro'] as const;

// Output of the model (spec 02, section 1), stored as qualificacao.classificacaoMensagem.
export interface Classificacao {
  tipoContato: TipoContato;
  pedido: string | null;
  dor: string | null;
  ferramentasCitadas: string[];
  gatilho: string | null;
  falaDeProblemaOuFerramenta: (typeof PROBLEMA_OU_FERRAMENTA)[number];
  idiomaMensagem: (typeof IDIOMAS_MENSAGEM)[number];
  observacao: string | null;
}

export interface Sinais {
  dominioCorporativo: boolean;
  cargoDecisor: boolean;
  temMensagem: boolean;
  siteInformado: boolean;
  siteResolvido: string | null;
}

export type Decisao = 'analisar' | 'responder_breve' | 'descartar';

export const dominioDe = (email: string): string => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

export function ehProvedorGratuito(dominio: string): boolean {
  const i = dominio.indexOf('.');
  return i > 0 && PROVEDORES.has(dominio.slice(0, i)) && SUFIXOS.has(dominio.slice(i + 1));
}

export function sinais(o: Original, n: Normalizado): Sinais {
  const dominio = dominioDe(n.email);
  const dominioCorporativo = !ehProvedorGratuito(dominio);
  return {
    dominioCorporativo,
    cargoDecisor: CARGOS_DECISORES.includes(o.cargo),
    temMensagem: Boolean(o.mensagem && o.mensagem.trim()),
    siteInformado: n.site !== null,
    siteResolvido: n.site ?? (dominioCorporativo ? `https://${dominio}` : null),
  };
}

// The model is called only when there is a message or the role is "other".
export const precisaModelo = (o: Original, s: Sinais): boolean => s.temMensagem || o.cargo === 'other';

// Decision rules (spec 02, section 1). motivo names the rule that fired.
export function decide(s: Sinais, c: Classificacao | null): { decisao: Decisao; motivo: string } {
  if (c?.tipoContato === 'spam') return { decisao: 'descartar', motivo: 'tipoContato = spam' };
  if (c && ['pessoa_fisica', 'estudante', 'fornecedor'].includes(c.tipoContato)) {
    return { decisao: 'responder_breve', motivo: `tipoContato = ${c.tipoContato}` };
  }
  if (!s.dominioCorporativo && !s.temMensagem) return { decisao: 'responder_breve', motivo: 'e-mail gratuito sem mensagem' };
  return { decisao: 'analisar', motivo: 'nenhuma regra de descarte ou de resposta breve' };
}

// JSON schema for structured outputs (objects closed, nullable fields as anyOf).
const textoOuNulo = { anyOf: [{ type: 'string' }, { type: 'null' }] };
export const ESQUEMA_CLASSIFICACAO = {
  type: 'object',
  properties: {
    tipoContato: { type: 'string', enum: [...TIPOS_CONTATO] },
    pedido: textoOuNulo,
    dor: textoOuNulo,
    ferramentasCitadas: { type: 'array', items: { type: 'string' } },
    gatilho: textoOuNulo,
    falaDeProblemaOuFerramenta: { type: 'string', enum: [...PROBLEMA_OU_FERRAMENTA] },
    idiomaMensagem: { type: 'string', enum: [...IDIOMAS_MENSAGEM] },
    observacao: textoOuNulo,
  },
  required: ['tipoContato', 'pedido', 'dor', 'ferramentasCitadas', 'gatilho', 'falaDeProblemaOuFerramenta', 'idiomaMensagem', 'observacao'],
  additionalProperties: false,
} as const;

// Defensive check of the model output before it is stored; throws on any mismatch.
export function validaClassificacao(v: unknown): Classificacao {
  const c = v as Record<string, unknown>;
  const textoNulo = (x: unknown) => x === null || typeof x === 'string';
  const ok =
    c && typeof c === 'object' &&
    (TIPOS_CONTATO as readonly unknown[]).includes(c.tipoContato) &&
    (PROBLEMA_OU_FERRAMENTA as readonly unknown[]).includes(c.falaDeProblemaOuFerramenta) &&
    (IDIOMAS_MENSAGEM as readonly unknown[]).includes(c.idiomaMensagem) &&
    Array.isArray(c.ferramentasCitadas) && c.ferramentasCitadas.every((x) => typeof x === 'string') &&
    textoNulo(c.pedido) && textoNulo(c.dor) && textoNulo(c.gatilho) && textoNulo(c.observacao);
  if (!ok) throw new Error('Classification does not match the schema');
  return {
    tipoContato: c.tipoContato as TipoContato,
    pedido: c.pedido as string | null,
    dor: c.dor as string | null,
    ferramentasCitadas: c.ferramentasCitadas as string[],
    gatilho: c.gatilho as string | null,
    falaDeProblemaOuFerramenta: c.falaDeProblemaOuFerramenta as Classificacao['falaDeProblemaOuFerramenta'],
    idiomaMensagem: c.idiomaMensagem as Classificacao['idiomaMensagem'],
    observacao: c.observacao as string | null,
  };
}

// User message of the call (spec 02, section 1): only the e-mail domain is sent.
export function promptQualificacao(o: Original, n: Normalizado, rotuloCargo: string): string {
  return [
    'Classifique o contato abaixo. Não pesquise nada; use só o que está na ficha.',
    '<ficha>',
    `nome: ${o.nome}`,
    `empresa: ${o.empresa}`,
    `cargo: ${o.cargo} (${rotuloCargo})`,
    `e-mail (apenas o domínio): ${dominioDe(n.email)}`,
    `site: ${o.site ?? '–'}`,
    `mensagem: ${o.mensagem ?? '–'}`,
    '</ficha>',
    'Responda no esquema.',
  ].join('\n');
}
