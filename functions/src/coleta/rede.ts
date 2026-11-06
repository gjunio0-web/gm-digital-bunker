// Outbound HTTP for the collection: guarded fetch of user-supplied URLs (the site comes from the
// form) and JSON calls to the providers. The guard refuses non-http(s) schemes, private or internal
// addresses (re-checked on every redirect), bodies above 2 MB, and stops after 10 s.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const LIMITE_BYTES = 2 * 1024 * 1024;
const PRAZO_MS = 10_000;
const MAX_REDIRECIONAMENTOS = 3;

// Private, loopback, link-local (metadata server), CGNAT, multicast and reserved ranges.
export function ipPrivado(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff')) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? ipPrivado(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

// Throws unless the URL is http(s) and every address its host resolves to is public.
export async function exigeEnderecoPublico(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('scheme not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('host not allowed');
  const enderecos = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!enderecos.length || enderecos.some((e) => ipPrivado(e.address))) throw new Error('address not allowed');
}

export interface Pagina {
  url: string;
  status: number;
  tipo: string;
  corpo: string;
  cabecalhos: Record<string, string>;
}

// Guarded GET of a page; follows up to 3 redirects, checking each target.
export async function buscaPagina(endereco: string): Promise<Pagina> {
  let url = new URL(endereco);
  for (let i = 0; i <= MAX_REDIRECIONAMENTOS; i++) {
    await exigeEnderecoPublico(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PRAZO_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; GMDigitalBunker-analise/1.0)', accept: 'text/html,application/xhtml+xml' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    const leitor = res.body?.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    while (leitor) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.length;
      if (total > LIMITE_BYTES) {
        await leitor.cancel();
        break;
      }
      partes.push(value);
    }
    const cabecalhos: Record<string, string> = {};
    res.headers.forEach((v, k) => (cabecalhos[k] = v));
    return { url: url.toString(), status: res.status, tipo: res.headers.get('content-type') ?? '', corpo: Buffer.concat(partes).toString('utf8'), cabecalhos };
  }
  throw new Error('too many redirects');
}

// JSON call to a fixed provider endpoint (not user-supplied, so no address guard).
export async function chamaJson(url: string, init: RequestInit = {}, prazoMs = 30_000): Promise<{ status: number; corpo: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(prazoMs) });
  const corpo = await res.json().catch(() => null);
  return { status: res.status, corpo };
}
