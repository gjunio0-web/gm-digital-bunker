// Server-side validation of a contact submission. Pure functions, no Firebase imports,
// so they can be tested with `node --test`. Mirrors the client rules in ContactForm.astro.

export const CARGOS = ['owner', 'ceo', 'director', 'manager', 'specialist', 'external', 'other'];
export const IDIOMAS = ['pt-BR', 'en'];
const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITES = { nome: 120, empresa: 160, email: 254, site: 300, mensagem: 4000 };

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// Website: optional; scheme may be omitted. Returns the normalized URL, '' when empty, or null when invalid.
export function normalizaSite(v) {
  if (v === '') return '';
  if (/\s/.test(v)) return null;
  const comEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(comEsquema);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')) return comEsquema;
  } catch { /* invalid URL */ }
  return null;
}

// Return path after a no-JavaScript submission: only the two contact pages, never an outside address.
const RETORNOS = { 'pt-BR': '/contato/', en: '/en/contact/' };

// Returns { ok: true, dados } or { ok: false, erros: [field names] }.
export function valida(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const dados = {
    nome: texto(c.nome),
    empresa: texto(c.empresa),
    cargo: texto(c.cargo),
    email: texto(c.email).toLowerCase(),
    site: normalizaSite(texto(c.site)),
    mensagem: texto(c.mensagem),
    lang: IDIOMAS.includes(c.lang) ? c.lang : 'pt-BR',
  };
  const erros = [];
  if (!dados.nome || dados.nome.length > LIMITES.nome) erros.push('nome');
  if (!dados.empresa || dados.empresa.length > LIMITES.empresa) erros.push('empresa');
  if (!CARGOS.includes(dados.cargo)) erros.push('cargo');
  if (!RX_EMAIL.test(dados.email) || dados.email.length > LIMITES.email) erros.push('email');
  if (dados.site === null || dados.site.length > LIMITES.site) erros.push('site');
  if (dados.mensagem.length > LIMITES.mensagem) erros.push('mensagem');
  return erros.length ? { ok: false, erros } : { ok: true, dados };
}

export const retornoPara = (lang) => RETORNOS[lang] ?? RETORNOS['pt-BR'];

// Honeypot: any content in the hidden field marks the submission as automated.
export const ehRobo = (corpo) => texto(corpo?.['empresa-site']) !== '';
