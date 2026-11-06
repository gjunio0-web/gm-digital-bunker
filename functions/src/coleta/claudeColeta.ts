// Collection calls to Claude (spec 02, sections 0 and 2): SISTEMA_BASE and method files as cached
// system blocks, web search and web fetch as server tools (basic versions, without dynamic
// filtering), pause_turn handled, JSON answer read from the text. Web search always returns
// citations, which the API refuses together with output_config.format, so the JSON is validated
// in code and asked once more if invalid (spec 02, section 0, item 4).
import { API, SISTEMA_BASE, VERSAO } from '../claude.js';
import type { Uso } from '../custo.js';

export interface PedidoColeta {
  chave: string;
  modelo: string;
  metodo: { nome: string; texto: string }[];
  usuario: string;
  maxBuscas: number;
  maxLeituras: number;
  valida: (json: unknown) => string | null; // error text, or null when valid
}

export interface RespostaColeta {
  json: unknown;
  uso: Uso;
  buscas: number;
  leituras: number;
  urlsConsultadas: Set<string>;
}

type Bloco = { type: string; text?: string; content?: unknown; url?: string };

// Output budget of a collection call. Adaptive thinking is on by default on Claude Haiku 5.5 and
// counts toward max_tokens (Claude docs, effort); 8,000 was not enough in the phase 3 test.
export const MAX_TOKENS_COLETA = 32_000;

// Failure that still carries what the call consumed, so the stage cost is not lost.
export class ErroColeta extends Error {
  constructor(mensagem: string, readonly parcial: RespostaColeta) {
    super(mensagem);
  }
}

// URL comparison key: no scheme, no www, no fragment, no trailing slash.
export const chaveUrl = (u: string) => u.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

export function extraiJson(texto: string): unknown {
  const i = texto.indexOf('{');
  const f = texto.lastIndexOf('}');
  if (i < 0 || f <= i) throw new Error('no JSON object in the answer');
  return JSON.parse(texto.slice(i, f + 1));
}

// URLs actually returned by web_search / web_fetch in the answer blocks.
export function urlsDosResultados(blocos: Bloco[]): string[] {
  const urls: string[] = [];
  for (const b of blocos) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content as { type: string; url?: string }[]) if (r.type === 'web_search_result' && r.url) urls.push(r.url);
    }
    if (b.type === 'web_fetch_tool_result' && b.content && typeof b.content === 'object') {
      const c = b.content as { type?: string; url?: string };
      if (c.type === 'web_fetch_result' && c.url) urls.push(c.url);
    }
  }
  return urls;
}

async function envia(chave: string, corpo: object): Promise<{ content: Bloco[]; stop_reason: string; usage: Uso & { server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } } }> {
  for (let tentativa = 1; ; tentativa++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': VERSAO },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(240_000),
    });
    if ((res.status === 429 || res.status >= 500) && tentativa === 1) {
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }
    const r = (await res.json().catch(() => null)) as any;
    if (!res.ok || !r) throw new Error(`Claude API HTTP ${res.status}: ${r?.error?.type ?? 'no body'}`);
    return r;
  }
}

export async function chamaColeta(p: PedidoColeta): Promise<RespostaColeta> {
  const system = [
    { type: 'text', text: SISTEMA_BASE, cache_control: { type: 'ephemeral' } },
    ...p.metodo.map((m) => ({ type: 'text', text: `<metodo arquivo="${m.nome}">\n${m.texto}\n</metodo>`, cache_control: { type: 'ephemeral' } })),
  ];
  const tools = [
    ...(p.maxBuscas > 0
      ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: p.maxBuscas, user_location: { type: 'approximate', country: 'BR', timezone: 'America/Sao_Paulo' } }]
      : []),
    ...(p.maxLeituras > 0 ? [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: p.maxLeituras, max_content_tokens: 8000 }] : []),
  ];
  const messages: { role: string; content: unknown }[] = [{ role: 'user', content: p.usuario }];
  const total: RespostaColeta = { json: null, uso: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, buscas: 0, leituras: 0, urlsConsultadas: new Set() };
  const soma = (u: Awaited<ReturnType<typeof envia>>['usage']) => {
    total.uso.input_tokens += u.input_tokens ?? 0;
    total.uso.output_tokens += u.output_tokens ?? 0;
    total.uso.cache_creation_input_tokens! += u.cache_creation_input_tokens ?? 0;
    total.uso.cache_read_input_tokens! += u.cache_read_input_tokens ?? 0;
    total.buscas += u.server_tool_use?.web_search_requests ?? 0;
    total.leituras += u.server_tool_use?.web_fetch_requests ?? 0;
  };

  let erro: string | null = null;
  for (let rodada = 0; rodada < 2; rodada++) {
    let texto = '';
    for (let volta = 0; volta < 4; volta++) {
      let r;
      try {
        r = await envia(p.chave, { model: p.modelo, max_tokens: MAX_TOKENS_COLETA, system, messages, ...(tools.length ? { tools } : {}) });
      } catch (e) {
        throw new ErroColeta(String((e as Error).message), total);
      }
      soma(r.usage);
      urlsDosResultados(r.content).forEach((u) => total.urlsConsultadas.add(chaveUrl(u)));
      messages.push({ role: 'assistant', content: r.content });
      if (r.stop_reason === 'pause_turn') continue;
      if (r.stop_reason !== 'end_turn') throw new ErroColeta(`Claude API stop_reason ${r.stop_reason} (output ${r.usage.output_tokens} tokens)`, total);
      texto = r.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      break;
    }
    try {
      const json = extraiJson(texto);
      erro = p.valida(json);
      if (!erro) {
        total.json = json;
        return total;
      }
    } catch (e) {
      erro = String((e as Error).message);
    }
    // One correction round, without new searches (spec 02, section 0, item 4).
    messages.push({ role: 'user', content: `A resposta anterior não está no formato pedido (${erro.slice(0, 300)}). Sem novas buscas, devolva somente o objeto JSON corrigido.` });
  }
  throw new ErroColeta(`invalid answer after correction: ${erro?.slice(0, 200)}`, total);
}
