// Site reading for empresa_digital (spec 02, section 2.2; spec 03, sections 3.1 and 4.2): up to six
// pages of text (about 6 thousand tokens in total), links to privacy/terms read only for CNPJ
// patterns, Instagram link, technologies by simple heuristics.
import { parse, type HTMLElement } from 'node-html-parser';
import { buscaPagina } from './rede.js';
import { extraiCnpjs } from './cnpj.js';

const LIMITE_CARACTERES = 18_000; // about 6 thousand tokens of Portuguese text in total
const LIMITE_POR_PAGINA = 6_000;

// Page kinds after the home page, in order, with the link patterns that identify them.
const TIPOS: [string, RegExp][] = [
  ['sobre', /(sobre|quem-somos|about|empresa|institucional|nossa-historia)/i],
  ['servicos', /(servic|produt|solucoe|solucoes|solutions|services|products|o-que-fazemos)/i],
  ['contato', /(contato|contact|fale-conosco)/i],
  ['noticias', /(blog|noticia|news|imprensa)/i],
  ['carreiras', /(carreira|trabalhe|vagas|careers|jobs)/i],
];
const LEGAL = /(privacidade|privacy|termos|terms|lgpd)/i;

export interface PaginaLida {
  url: string;
  tipo: string;
  titulo: string;
  texto: string;
}

export interface LeituraSite {
  paginas: PaginaLida[];
  cnpjs: string[];
  instagram: string | null;
  tecnologias: string[];
  falhas: string[];
}

export function textoDe(raiz: HTMLElement): string {
  raiz.querySelectorAll('script,style,noscript,svg,iframe,template').forEach((n) => n.remove());
  return raiz.text.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

// Same-site links of the page, absolute, without fragments.
export function linksDe(raiz: HTMLElement, base: URL): URL[] {
  const vistos = new Set<string>();
  const saida: URL[] = [];
  for (const a of raiz.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href')!, base);
      u.hash = '';
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '') && !vistos.has(u.href)) {
        vistos.add(u.href);
        saida.push(u);
      }
    } catch {
      /* invalid href */
    }
  }
  return saida;
}

// Company Instagram profile linked from the page (first profile link, not posts or reels).
export function instagramDe(raiz: HTMLElement): string | null {
  for (const a of raiz.querySelectorAll('a[href*="instagram.com"]')) {
    const m = a.getAttribute('href')!.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/);
    if (m && !['p', 'reel', 'reels', 'explore', 'stories', 'accounts'].includes(m[1].toLowerCase())) return m[1];
  }
  return null;
}

// Technologies by simple heuristics: generator meta, response headers and known script hosts.
export function tecnologiasDe(html: string, cabecalhos: Record<string, string>): string[] {
  const t = new Set<string>();
  const gerador = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1];
  if (gerador) t.add(gerador.slice(0, 60));
  const regras: [RegExp, string][] = [
    [/wp-content|wp-includes/i, 'WordPress'], [/cdn\.shopify\.com/i, 'Shopify'], [/static\.wixstatic\.com|wix\.com/i, 'Wix'],
    [/vtex/i, 'VTEX'], [/nuvemshop|tiendanube/i, 'Nuvemshop'], [/googletagmanager\.com/i, 'Google Tag Manager'],
    [/google-analytics\.com|gtag\(/i, 'Google Analytics'], [/connect\.facebook\.net/i, 'Meta Pixel'], [/hotjar/i, 'Hotjar'],
    [/rdstation/i, 'RD Station'], [/hubspot/i, 'HubSpot'], [/zendesk/i, 'Zendesk'], [/intercom/i, 'Intercom'],
    [/wa\.me\/|api\.whatsapp\.com/i, 'link de WhatsApp'], [/_next\/static/i, 'Next.js'], [/__nuxt/i, 'Nuxt'], [/react/i, 'React'],
  ];
  for (const [re, nome] of regras) if (re.test(html)) t.add(nome);
  const servidor = cabecalhos['server'];
  if (servidor) t.add(`servidor: ${servidor.slice(0, 40)}`);
  if (cabecalhos['x-powered-by']) t.add(`x-powered-by: ${cabecalhos['x-powered-by'].slice(0, 40)}`);
  return [...t];
}

export async function leSite(endereco: string): Promise<LeituraSite> {
  const saida: LeituraSite = { paginas: [], cnpjs: [], instagram: null, tecnologias: [], falhas: [] };
  let restante = LIMITE_CARACTERES;
  const cnpjs = new Set<string>();
  const adiciona = (url: string, tipo: string, raiz: HTMLElement) => {
    const titulo = raiz.querySelector('title')?.text.trim().slice(0, 150) ?? '';
    const texto = textoDe(raiz);
    extraiCnpjs(texto).forEach((c) => cnpjs.add(c));
    const corte = texto.slice(0, Math.min(LIMITE_POR_PAGINA, restante));
    restante -= corte.length;
    saida.paginas.push({ url, tipo, titulo, texto: corte });
  };

  let inicial;
  try {
    inicial = await buscaPagina(endereco);
    if (inicial.status >= 400 || !/html/i.test(inicial.tipo)) throw new Error(`HTTP ${inicial.status}`);
  } catch (e) {
    saida.falhas.push(`inicial: ${String((e as Error).message).slice(0, 80)}`);
    return saida;
  }
  const base = new URL(inicial.url);
  const raiz = parse(inicial.corpo);
  saida.instagram = instagramDe(raiz);
  saida.tecnologias = tecnologiasDe(inicial.corpo, inicial.cabecalhos);
  const links = linksDe(raiz, base);
  adiciona(inicial.url, 'inicial', raiz);

  for (const [tipo, re] of TIPOS) {
    if (restante <= 0) break;
    const alvo = links.find((u) => re.test(u.pathname));
    if (!alvo) continue;
    try {
      const p = await buscaPagina(alvo.href);
      if (p.status < 400 && /html/i.test(p.tipo)) adiciona(p.url, tipo, parse(p.corpo));
    } catch (e) {
      saida.falhas.push(`${tipo}: ${String((e as Error).message).slice(0, 80)}`);
    }
  }
  // Privacy and terms pages: CNPJ patterns only, text not sent to the model.
  for (const alvo of links.filter((u) => LEGAL.test(u.pathname)).slice(0, 2)) {
    try {
      const p = await buscaPagina(alvo.href);
      if (p.status < 400) extraiCnpjs(textoDe(parse(p.corpo))).forEach((c) => cnpjs.add(c));
    } catch {
      /* optional pages */
    }
  }
  saida.cnpjs = [...cnpjs];
  return saida;
}
