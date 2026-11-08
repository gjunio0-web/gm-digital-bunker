// Outbound HTTP for the collection: guarded fetch of user-supplied URLs (the site comes from the
// form) and JSON calls to the providers. The guard refuses non-http(s) schemes, private or internal
// addresses (re-checked on every redirect, and the connection made to the address checked), bodies above
// 2 MB, and stops after 10 s.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';

const LIMITE_BYTES = 2 * 1024 * 1024;
const PRAZO_MS = 10_000;
const MAX_REDIRECIONAMENTOS = 3;

// Address classification by ipaddr.js (phase 6, decision of Gon, 8/11/2026): the URL parser of Node writes an
// IPv4-mapped IPv6 address in hex ("::ffff:a9fe:a9fe" for 169.254.169.254), which a text pattern misses.
// IPv4: the private, loopback, link-local (metadata server), CGNAT, benchmark, multicast and reserved ranges of
// the former list, plus anything ipaddr.js does not class as unicast. IPv6: only global unicast passes; the
// IPv4-mapped form is checked as IPv4, and translation or tunnel prefixes that embed an IPv4 address
// (64:ff9b::/96 NAT64, 2002::/16 6to4, Teredo) are refused outright. Anything that does not parse is refused.
export function ipPrivado(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return true;
  const a = ipaddr.parse(ip);
  if (a.kind() === 'ipv6') {
    const v6 = a as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return ipPrivado(v6.toIPv4Address().toString());
    return v6.range() !== 'unicast';
  }
  const [o1, o2] = (a as ipaddr.IPv4).octets;
  return (
    o1 === 0 || o1 === 10 || o1 === 127 || (o1 === 100 && o2 >= 64 && o2 <= 127) || (o1 === 169 && o2 === 254) ||
    (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 198 && (o2 === 18 || o2 === 19)) || o1 >= 224 ||
    a.range() !== 'unicast'
  );
}

export interface Endereco { address: string; family: number }
export type Resolvedor = (host: string) => Promise<Endereco[]>;
const resolvePadrao: Resolvedor = (host) => lookup(host, { all: true });

// Throws unless the URL is http(s) and every address its host resolves to is public; returns the address the
// connection must use (the first one), so the check and the access see the same address.
export async function exigeEnderecoPublico(url: URL, resolve: Resolvedor = resolvePadrao, publico: (ip: string) => boolean = (ip) => !ipPrivado(ip)): Promise<Endereco> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('scheme not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('host not allowed');
  const enderecos = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (!enderecos.length || enderecos.some((e) => !publico(e.address))) throw new Error('address not allowed');
  return enderecos[0];
}

export interface Pagina {
  url: string;
  status: number;
  tipo: string;
  corpo: string;
  cabecalhos: Record<string, string>;
}

// A connection pool whose name resolution answers only with the address already checked: the fetch cannot
// resolve the host again between the check and the access (DNS rebinding). TLS still checks the certificate
// against the host name of the URL.
function agenteFixo(e: Endereco): Agent {
  return new Agent({
    connect: {
      lookup: (_host: string, opcoes: { all?: boolean }, cb: (err: Error | null, endereco: any, familia?: number) => void) =>
        opcoes?.all ? cb(null, [{ address: e.address, family: e.family }]) : cb(null, e.address, e.family),
    } as any,
  });
}

// Guarded GET of a page; follows up to 3 redirects, checking each target and connecting to the checked address.
// resolve and publico are replaced only by the tests.
export async function buscaPagina(endereco: string, resolve: Resolvedor = resolvePadrao, publico?: (ip: string) => boolean): Promise<Pagina> {
  let url = new URL(endereco);
  for (let i = 0; i <= MAX_REDIRECIONAMENTOS; i++) {
    const alvo = await exigeEnderecoPublico(url, resolve, publico);
    const agente = agenteFixo(alvo);
    try {
      const res = await fetch(url, {
        dispatcher: agente,
        redirect: 'manual',
        signal: AbortSignal.timeout(PRAZO_MS),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; GMDigitalBunker-analise/1.0)', accept: 'text/html,application/xhtml+xml' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel();
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
    } finally {
      await agente.close().catch(() => undefined);
    }
  }
  throw new Error('too many redirects');
}

// JSON call to a fixed provider endpoint (not user-supplied, so no address guard).
export async function chamaJson(url: string, init: RequestInit = {}, prazoMs = 30_000): Promise<{ status: number; corpo: unknown }> {
  const res = await globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(prazoMs) });
  const corpo = await res.json().catch(() => null);
  return { status: res.status, corpo };
}
