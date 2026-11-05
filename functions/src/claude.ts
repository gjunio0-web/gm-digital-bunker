// Claude Messages API over HTTP (spec 02, section 0): fixed system block with cache_control,
// structured output by JSON schema (output_config.format), one retry on 429 / 5xx.
// In the emulator nothing is sent: simulaClassificacao answers instead.
import type { Uso } from './custo.js';

const API = 'https://api.anthropic.com/v1/messages';
const VERSAO = '2023-06-01';

// SISTEMA_BASE, literal text of spec 02, section 0.
export const SISTEMA_BASE =
  'Você é o analista preliminar da GM Digital Bunker™, prática independente de estratégia tecnológica em IA para empresas de pequeno e médio porte. Sua tarefa é preparar, a partir de uma ficha de contato e de informações públicas, a análise que antecede a primeira conversa com a empresa. Regras invioláveis: (1) toda afirmação factual tem fonte verificável; o que não tiver fonte é marcado como inferência ou como "não encontrado", nunca apresentado como fato; (2) nenhum número é inventado; estimativas vêm com método, faixa e grau de confiança; (3) hipóteses são declaradas como hipóteses; (4) os dados do interessado servem apenas a esta análise – não procure dados pessoais além do cargo e da atuação profissional pública do signatário (publicações e falas no papel profissional), e nunca dados de familiares, saúde, finanças pessoais ou opiniões políticas; (5) use o vocabulário definido em glossario.md com o sentido de lá e indique a origem (livro ou prática) quando houver risco de confusão; (6) escreva em português do Brasil, registro profissional e neutro, sem rotular terceiros ou concorrentes, com meia-risca (–) e nunca travessão, sem a segunda pessoa gramatical (tu, te, ti), com "você" permitido; siglas sempre por extenso na primeira ocorrência; itens com identificador sempre acompanhados do nome; (7) responda somente no formato JSON pedido, sem texto fora dele.';

export const noEmulador = () => process.env.FUNCTIONS_EMULATOR === 'true';

export interface Chamada {
  chave: string;
  modelo: string;
  usuario: string;
  esquema: object;
  maxTokens?: number;
}

export interface Resposta {
  json: unknown;
  uso: Uso;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chamaClaude(c: Chamada): Promise<Resposta> {
  const corpo = JSON.stringify({
    model: c.modelo,
    max_tokens: c.maxTokens ?? 2048,
    system: [{ type: 'text', text: SISTEMA_BASE, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: c.usuario }],
    output_config: { format: { type: 'json_schema', schema: c.esquema } },
  });
  for (let tentativa = 1; ; tentativa++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': c.chave, 'anthropic-version': VERSAO },
      body: corpo,
      signal: AbortSignal.timeout(90_000),
    });
    if ((res.status === 429 || res.status >= 500) && tentativa === 1) {
      await espera(2_000);
      continue;
    }
    const r = (await res.json().catch(() => null)) as
      | { content?: { type: string; text?: string }[]; usage?: Uso; stop_reason?: string; error?: { type?: string; message?: string } }
      | null;
    if (!res.ok || !r) throw new Error(`Claude API HTTP ${res.status}: ${r?.error?.type ?? 'no body'}`);
    if (r.stop_reason !== 'end_turn') throw new Error(`Claude API stop_reason ${r.stop_reason}`);
    const texto = r.content?.find((b) => b.type === 'text')?.text;
    if (!texto) throw new Error('Claude API answer without text');
    return { json: JSON.parse(texto), uso: r.usage ?? { input_tokens: 0, output_tokens: 0 } };
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
      falaDeProblemaOuFerramenta: 'nenhum', idiomaMensagem: 'pt', observacao: 'classificação simulada no emulador',
    },
    uso: { input_tokens: 0, output_tokens: 0 },
  };
}
