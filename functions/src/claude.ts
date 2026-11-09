// Claude Messages API over HTTP (spec 02, section 0): fixed system block with cache_control,
// structured output by JSON schema (output_config.format) or, without a schema, JSON asked for in the text
// and read by extraiJson; one retry on 429 / 5xx.
// In the emulator nothing is sent: simulaClassificacao answers instead.
import type { Uso } from './custo.js';

export const API = 'https://api.anthropic.com/v1/messages';
export const VERSAO = '2023-06-01';

// SISTEMA_BASE, literal text of spec 02 v0.12, section 0 (rule 8 since v0.12).
export const SISTEMA_BASE =
  'Você é o analista preliminar da GM Digital Bunker™, prática independente de estratégia tecnológica em IA para empresas de pequeno e médio porte. Sua tarefa é preparar, a partir de uma ficha de contato e de informações públicas, a análise que antecede a primeira conversa com a empresa. Regras invioláveis: (1) toda afirmação factual tem fonte verificável; o que não tiver fonte é marcado como inferência ou como "não encontrado", nunca apresentado como fato; (2) nenhum número é inventado; estimativas vêm com método, faixa e grau de confiança; (3) hipóteses são declaradas como hipóteses; (4) os dados do interessado servem apenas a esta análise – não procure dados pessoais além do cargo e da atuação profissional pública do signatário (publicações e falas no papel profissional), e nunca dados de familiares, saúde, finanças pessoais ou opiniões políticas; (5) use o vocabulário definido em glossario.md com o sentido de lá e indique a origem (livro ou prática) quando houver risco de confusão; (6) escreva em português do Brasil, registro profissional e neutro, sem rotular terceiros ou concorrentes, com meia-risca (–) e nunca travessão, sem a segunda pessoa gramatical (tu, te, ti), com "você" permitido; siglas sempre por extenso na primeira ocorrência; itens com identificador sempre acompanhados do nome; (7) responda somente no formato JSON pedido, sem texto fora dele; (8) sobre a GM Digital Bunker™, seus serviços, limites e casos, afirme apenas o que consta de escopo-limites.md e portas-materiais.md; não acrescente atributos a casos (autorização do cliente, porte, resultados medidos) nem a serviços.';

export const noEmulador = () => process.env.FUNCTIONS_EMULATOR === 'true';

export interface Chamada {
  chave: string;
  modelo: string;
  // A plain text, or text blocks; a block with cache = true ends a cached prefix (e.g. the collection
  // blocks the three synthesis calls share).
  usuario: string | { texto: string; cache?: boolean }[];
  // Strict output schema (output_config.format). Without it (the correction, whose combined schema exceeds the
  // API's compiled grammar limit – phase B2, decision of Gon, 9/11/2026) the format goes in the prompt and the
  // caller checks the answer.
  esquema?: object;
  // Method files as extra system blocks (spec 02, section 0). The API accepts at most 4 cache breakpoints
  // per request, so only the last method block carries cache_control: the cached prefix covers SISTEMA_BASE
  // and every method block before it.
  metodo?: { nome: string; texto: string }[];
  // Adaptive thinking counts toward max_tokens, so the default leaves room for it.
  maxTokens?: number;
  timeoutMs?: number;
  // output_config.effort; omitted (the model default) when empty.
  esforco?: string;
}

export interface Resposta {
  json: unknown;
  uso: Uso;
}

// A failed answer that was still billed (e.g. stop_reason max_tokens): carries the usage, so the caller
// can count its cost.
export class ErroComUso extends Error {
  constructor(mensagem: string, readonly uso: Uso) {
    super(mensagem);
  }
}

// JSON of an answer without a strict schema: the object between the first "{" and the last "}", so a code
// fence or a line of text around it does not matter. Throws when there is no valid object.
export function extraiJson(texto: string): unknown {
  const i = texto.indexOf('{');
  const f = texto.lastIndexOf('}');
  if (i < 0 || f < i) throw new Error('no JSON object');
  return JSON.parse(texto.slice(i, f + 1));
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chamaClaude(c: Chamada): Promise<Resposta> {
  const corpo = JSON.stringify({
    model: c.modelo,
    max_tokens: c.maxTokens ?? 16_000,
    system: [
      { type: 'text', text: SISTEMA_BASE, ...(c.metodo?.length ? {} : { cache_control: { type: 'ephemeral' } }) },
      ...(c.metodo ?? []).map((m, i, todos) => ({
        type: 'text',
        text: `<metodo arquivo="${m.nome}">\n${m.texto}\n</metodo>`,
        ...(i === todos.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
      })),
    ],
    messages: [{
      role: 'user',
      content: typeof c.usuario === 'string'
        ? c.usuario
        : c.usuario.map((b) => ({ type: 'text', text: b.texto, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) })),
    }],
    ...(c.esquema || c.esforco
      ? { output_config: { ...(c.esquema ? { format: { type: 'json_schema', schema: c.esquema } } : {}), ...(c.esforco ? { effort: c.esforco } : {}) } }
      : {}),
  });
  for (let tentativa = 1; ; tentativa++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': c.chave, 'anthropic-version': VERSAO },
      body: corpo,
      signal: AbortSignal.timeout(c.timeoutMs ?? 180_000),
    });
    if ((res.status === 429 || res.status >= 500) && tentativa === 1) {
      await espera(2_000);
      continue;
    }
    const r = (await res.json().catch(() => null)) as
      | { content?: { type: string; text?: string }[]; usage?: Uso; stop_reason?: string; error?: { type?: string; message?: string } }
      | null;
    // The API message says what in the request was refused (schema, parameter); it describes the request,
    // not the ficha, and is cut short before it reaches the logs.
    if (!res.ok || !r) throw new Error(`Claude API HTTP ${res.status}: ${r?.error?.type ?? 'no body'}${r?.error?.message ? ` – ${r.error.message.slice(0, 300)}` : ''}`);
    if (r.stop_reason !== 'end_turn') throw new ErroComUso(`Claude API stop_reason ${r.stop_reason}`, r.usage ?? { input_tokens: 0, output_tokens: 0 });
    const texto = r.content?.find((b) => b.type === 'text')?.text;
    if (!texto) throw new Error('Claude API answer without text');
    const uso = r.usage ?? { input_tokens: 0, output_tokens: 0 };
    // A billed answer that is not JSON still counts in the cost.
    try {
      return { json: c.esquema ? JSON.parse(texto) : extraiJson(texto), uso };
    } catch {
      throw new ErroComUso('Claude API answer is not valid JSON', uso);
    }
  }
}

// Tokens of one text as a system block (count_tokens, free; an estimate per the docs): the count
// with the block minus the count of the same request without it.
export async function contaTokens(chave: string, modelo: string, texto: string): Promise<number> {
  const conta = async (system?: string) => {
    const res = await fetch(`${API}/count_tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': VERSAO },
      body: JSON.stringify({ model: modelo, ...(system ? { system: [{ type: 'text', text: system }] } : {}), messages: [{ role: 'user', content: '.' }] }),
      signal: AbortSignal.timeout(30_000),
    });
    const r = (await res.json().catch(() => null)) as { input_tokens?: number; error?: { type?: string } } | null;
    if (!res.ok || typeof r?.input_tokens !== 'number') throw new Error(`count_tokens HTTP ${res.status}: ${r?.error?.type ?? 'no body'}`);
    return r.input_tokens;
  };
  return (await conta(texto)) - (await conta());
}

// Emulator stand-in for the qualification call: keyword rules over the message, zero usage.
export function simulaClassificacao(mensagem: string | null): Resposta {
  const m = (mensagem ?? '').toLowerCase();
  const tipoContato = m.includes('spam') ? 'spam' : m.includes('estudante') ? 'estudante' : m.includes('fornecedor') ? 'fornecedor' : 'empresa';
  return {
    json: {
      tipoContato, pedido: m ? 'pedido simulado' : null, dor: null, ferramentasCitadas: [], gatilho: null,
      falaDeProblemaOuFerramenta: m ? 'problema' : 'nenhum', idiomaMensagem: 'pt', observacao: 'classificação simulada no emulador',
      estruturaTecnologia: { categoria: m ? 'enxuta' : 'sem_sinal', evidencia: 'simulação' },
      portaIndicada: m.includes('conselho') ? { porta: 'conselho', sinais: ['simulação', 'simulação'] } : { porta: 'indeterminada', sinais: [] },
    },
    uso: { input_tokens: 0, output_tokens: 0 },
  };
}
