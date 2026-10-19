// Post-build SEO checks over dist/. Run: npm run build && npm run check:seo
// Errors fail the run (exit 1); warnings are reported only.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { datas } from '../src/lib/datas.mjs';

const DIST = new URL('../dist/', import.meta.url).pathname;
const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? (n === '_astro' ? [] : walk(p)) : p.endsWith('.html') ? [p] : [];
});
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const one = (html, re) => { const m = html.match(re); return m ? decode(m[1]) : undefined; };

const pages = walk(DIST).map((file) => {
  const html = readFileSync(file, 'utf8');
  const f = relative(DIST, file);
  return {
    f, html,
    title: one(html, /<title>([^<]*)<\/title>/),
    description: one(html, /<meta name="description" content="([^"]*)"/),
    canonical: one(html, /<link rel="canonical" href="([^"]*)"/),
    robots: one(html, /<meta name="robots" content="([^"]*)"/),
    hreflang: Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]])),
    jsonld: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]),
  };
});

const byCanonical = new Map(pages.filter((p) => p.canonical).map((p) => [p.canonical, p]));
const titles = new Map();

for (const p of pages) {
  const is404 = p.f === '404.html';
  if (!p.title) err(p.f, 'missing <title>');
  else titles.set(p.title, [...(titles.get(p.title) ?? []), p.f]);
  if (!p.description) err(p.f, 'missing meta description');
  else if (p.description.length < 70 || p.description.length > 160) warn(p.f, `description has ${p.description.length} characters (target 70–160)`);
  if (p.title && /^(.+?) – GM Digital Bunker™$/.test(p.title) && /GM Digital Bunker™/.test(p.title.replace(/ – GM Digital Bunker™$/, ''))) warn(p.f, `brand repeated in title: "${p.title}"`);

  if (is404) {
    if (p.canonical) err(p.f, '404 must not declare a canonical');
    if (Object.keys(p.hreflang).length) err(p.f, '404 must not declare hreflang');
    if (!p.robots?.includes('noindex')) err(p.f, '404 must be noindex');
  } else {
    if (!p.canonical) err(p.f, 'missing canonical');
    for (const l of ['pt-BR', 'en', 'x-default']) if (!p.hreflang[l]) err(p.f, `missing hreflang ${l}`);
    // Reciprocity: the page that hreflang points to must point back, and be a built page.
    for (const l of ['pt-BR', 'en']) {
      const alvo = byCanonical.get(p.hreflang[l]);
      if (!alvo) { err(p.f, `hreflang ${l} points to a page that does not exist: ${p.hreflang[l]}`); continue; }
      if (alvo.hreflang[l] !== p.hreflang[l]) err(p.f, `hreflang ${l} is not reciprocal with ${alvo.f}`);
    }
  }
  for (const [i, raw] of p.jsonld.entries()) {
    try { JSON.parse(raw); } catch (e) { err(p.f, `JSON-LD block ${i + 1} is not valid JSON: ${e.message}`); }
  }
  if (/\[[^\]\n]{2,60}\]/.test(p.html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' '))) warn(p.f, 'visible text still has a [bracketed] placeholder');
}
// Duplicate titles are a warning until stage C (titles) is approved: the two home pages share "GM Digital Bunker™".
for (const [t, fs] of titles) if (fs.length > 1) warn(fs.join(', '), `duplicate title "${t}"`);

// Sitemap: every URL must be a canonical of a built page, and every indexable page must be listed.
const sitemapFile = join(DIST, 'sitemap-0.xml');
if (!existsSync(sitemapFile)) err('sitemap-0.xml', 'missing');
else {
  const urls = [...readFileSync(sitemapFile, 'utf8').matchAll(/<url><loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const u of urls) if (!byCanonical.has(u)) err('sitemap-0.xml', `URL is not the canonical of any page: ${u}`);
  for (const c of byCanonical.keys()) if (!urls.includes(c)) err('sitemap-0.xml', `canonical missing from the sitemap: ${c}`);
}
for (const p of pages) if (p.f !== '404.html' && !p.jsonld.length) warn(p.f, 'no JSON-LD');

// JSON-LD: every { "@id": … } reference must resolve to a node of the same @graph.
for (const p of pages) {
  for (const raw of p.jsonld) {
    let j; try { j = JSON.parse(raw); } catch { continue; }
    if (!j['@graph']) continue;
    const ids = new Set(j['@graph'].map((n) => n['@id']));
    const visit = (x, dono) => {
      if (Array.isArray(x)) x.forEach((v) => visit(v, dono));
      else if (x && typeof x === 'object') {
        const k = Object.keys(x);
        if (k.length === 1 && k[0] === '@id' && !ids.has(x['@id'])) err(p.f, `JSON-LD reference does not resolve: ${x['@id']}`);
        Object.values(x).forEach((v) => visit(v, dono));
      }
    };
    for (const n of j['@graph']) for (const [k, v] of Object.entries(n)) if (k !== '@id') visit(v, n['@type']);
  }
}

// Dates (src/lib/datas.mjs): warn when a source file was committed after the page's `atualizado` date.
try {
  for (const [lang, paginas] of Object.entries(datas)) {
    for (const [id, d] of Object.entries(paginas)) {
      for (const arq of d.arquivos) {
        const ultimo = execFileSync('git', ['log', '-1', '--format=%cs', '--', arq], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).trim();
        if (ultimo && ultimo > d.atualizado) warn(`${lang}/${id}`, `${arq} was committed on ${ultimo}, after atualizado ${d.atualizado}: update src/lib/datas.mjs if the text changed`);
      }
    }
  }
} catch { /* no git available: skip */ }

console.log(`${pages.length} pages checked`);
for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`ERROR    ${e}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
