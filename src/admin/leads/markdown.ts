// Restricted Markdown for the dossier sections (spec 05 §5.6; guide v1.4 §5.3). Pure functions only: text in,
// HTML out. Supported: paragraphs, **bold**, *italic*, bulleted and numbered lists, "###" headings and
// http/https links. Raw HTML is never interpreted (every character is escaped) and images are shown as their
// alt text. Marks of the pipeline are recognised inline: [F:etapa:idx] (with or without the link the pipeline
// adds), [inferência] and [M:arquivo:seção]. Anything else is plain text, so an unknown construct never breaks
// the page.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------- Inline ----------
export type No =
  | { t: 'txt'; s: string }
  | { t: 'b' | 'i'; c: No[] }
  | { t: 'a'; href: string; c: No[] }
  | { t: 'f'; etapa: string; idx: number }
  | { t: 'inf'; s: string }
  | { t: 'm'; arq: string; sec: string };

export const urlSegura = (u: string): boolean => /^https?:\/\/[^\s<>"]+$/i.test(u);

/** Index of the ")" that closes the "(" at position k, counting nested pairs; -1 when it never closes. */
function fechaParen(s: string, k: number): number {
  let n = 0;
  for (let i = k; i < s.length; i++) {
    if (s[i] === '(') n++;
    else if (s[i] === ')' && --n === 0) return i;
  }
  return -1;
}
/** Index of the "]" that closes the "[" at position k, counting nested pairs; -1 when it never closes. */
function fechaColchete(s: string, k: number): number {
  let n = 0;
  for (let i = k; i < s.length; i++) {
    if (s[i] === '[') n++;
    else if (s[i] === ']' && --n === 0) return i;
  }
  return -1;
}

export function inline(src: string): No[] {
  const out: No[] = [];
  let buf = '';
  const solta = () => { if (buf) { out.push({ t: 'txt', s: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '*' && src[i + 1] === '*') {
      const j = src.indexOf('**', i + 2);
      if (j > i + 2) { solta(); out.push({ t: 'b', c: inline(src.slice(i + 2, j)) }); i = j + 2; continue; }
    } else if (c === '*' && src[i + 1] && !/\s/.test(src[i + 1])) {
      const j = src.indexOf('*', i + 1);
      if (j > i + 1 && src[j - 1] !== ' ' && src[j + 1] !== '*') { solta(); out.push({ t: 'i', c: inline(src.slice(i + 1, j)) }); i = j + 1; continue; }
    } else if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const img = c === '!';
      const k = img ? i + 1 : i;
      const rest = src.slice(k);
      let m: RegExpExecArray | null;
      if (!img && (m = /^\[F:([a-z_]+):(\d+)\]/.exec(rest))) {
        solta();
        out.push({ t: 'f', etapa: m[1], idx: Number(m[2]) });
        i = k + m[0].length;
        // The pipeline appends "(url)" to a valid mark: it is consumed, the destination is s8
        if (src[i] === '(') { const e = fechaParen(src, i); if (e > 0) i = e + 1; }
        continue;
      }
      if (!img && (m = /^\[(inferência[^\]]*)\]/i.exec(rest))) { solta(); out.push({ t: 'inf', s: m[1] }); i = k + m[0].length; continue; }
      if (!img && (m = /^\[M:([^:\]]+):([^\]]+)\]/.exec(rest))) { solta(); out.push({ t: 'm', arq: m[1], sec: m[2] }); i = k + m[0].length; continue; }
      const f = fechaColchete(src, k);
      if (f > 0 && src[f + 1] === '(') {
        const e = fechaParen(src, f + 1);
        if (e > 0) {
          const rotulo = src.slice(k + 1, f);
          const href = src.slice(f + 2, e).trim();
          solta();
          if (img) out.push({ t: 'txt', s: rotulo });
          else if (urlSegura(href)) out.push({ t: 'a', href, c: inline(rotulo) });
          else out.push(...inline(rotulo));
          i = e + 1;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  solta();
  return out;
}

/** Visible text of a node list: marks count as nothing, so the match of a finding ignores them. */
export function textoVisivel(ns: No[]): string {
  return ns.map((n) => (n.t === 'txt' ? n.s : n.t === 'b' || n.t === 'i' || n.t === 'a' ? textoVisivel(n.c) : '')).join('');
}

// ---------- Blocks ----------
export type Bloco =
  | { k: 'p'; ns: No[] }
  | { k: 'h'; ns: No[] }
  | { k: 'ul' | 'ol'; itens: No[][] };

export function blocos(md: string): Bloco[] {
  const linhas = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: Bloco[] = [];
  let par: string[] = [];
  let lista: { k: 'ul' | 'ol'; itens: string[] } | null = null;
  const fechaPar = () => { if (par.length) { out.push({ k: 'p', ns: inline(par.join(' ')) }); par = []; } };
  const fechaLista = () => { if (lista) { out.push({ k: lista.k, itens: lista.itens.map(inline) }); lista = null; } };
  for (const bruta of linhas) {
    const l = bruta.replace(/\s+$/, '');
    if (!l.trim()) { fechaPar(); fechaLista(); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(l))) { fechaPar(); fechaLista(); out.push({ k: 'h', ns: inline(m[1]) }); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { fechaPar(); fechaLista(); continue; } // horizontal rule: nothing to show
    if ((m = /^\s{0,3}[-*+]\s+(.*)$/.exec(l))) {
      fechaPar();
      if (lista?.k !== 'ul') { fechaLista(); lista = { k: 'ul', itens: [] }; }
      lista.itens.push(m[1]);
      continue;
    }
    if ((m = /^\s{0,3}\d+[.)]\s+(.*)$/.exec(l))) {
      fechaPar();
      if (lista?.k !== 'ol') { fechaLista(); lista = { k: 'ol', itens: [] }; }
      lista.itens.push(m[1]);
      continue;
    }
    if (lista && /^\s+\S/.test(l)) { lista.itens[lista.itens.length - 1] += ' ' + l.trim(); continue; } // continuation of an item
    fechaLista();
    par.push(l.trim());
  }
  fechaPar(); fechaLista();
  return out;
}

// ---------- Marked passages (findings of the verification) ----------
export interface Marca { texto: string; rotulo: string; aviso: boolean }
interface Faixa { de: number; ate: number; rotulo: string; aviso: boolean }

const colapsa = (s: string) => {
  let t = '';
  const mapa: number[] = [];
  let espaco = true; // drop leading spaces
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) { if (!espaco) { t += ' '; mapa.push(i); espaco = true; } }
    else { t += s[i]; mapa.push(i); espaco = false; }
  }
  if (t.endsWith(' ')) { t = t.slice(0, -1); mapa.pop(); }
  return { t, mapa };
};

/** Exact match of a quoted passage in the visible text of a block; null when there is none. */
export function acha(visivel: string, trecho: string): [number, number] | null {
  const a = colapsa(visivel), b = colapsa(textoVisivel(inline(trecho)));
  if (b.t.length < 3) return null;
  const k = a.t.indexOf(b.t);
  return k < 0 ? null : [a.mapa[k], a.mapa[k + b.t.length - 1] + 1];
}

// ---------- HTML ----------
export interface Contexto {
  /** "etapa:idx" → number in the s8 list; a mark with no entry is shown as "[fonte]" */
  fontes: Map<string, number>;
  /** Findings of the section, underlined where their passage matches exactly one block */
  marcas: Marca[];
  /** The "hipótese" tag: on the paragraphs under the label "Hipóteses de alavanca." (s6) */
  hipotese: boolean;
}

const TAG_HIP = '<span class="hip">hipótese</span>';

export interface Saida { html: string; achadas: boolean[] }

/** Renders blocks to HTML; `achadas[i]` tells whether the i-th mark found its passage. */
export function renderBlocos(bs: Bloco[], ctx: Contexto): Saida {
  const achadas = ctx.marcas.map(() => false);
  const rotuloInicial = (ns: No[]): string | null => {
    if (ns[0]?.t !== 'b') return null;
    const t = textoVisivel((ns[0] as { c: No[] }).c).trim();
    return /[.:]$/.test(t) ? t : null; // a label ends with a period or colon inside the bold
  };
  let emHip = false;
  const html = bs.map((b) => {
    if (b.k === 'h') return `<h4 class="dsub">${renderNos(b.ns, ctx, [], 0)}</h4>`;
    const lote = b.k === 'p' ? [b.ns] : b.itens;
    const itens = lote.map((ns) => {
      const visivel = textoVisivel(ns);
      const faixas: Faixa[] = [];
      ctx.marcas.forEach((m, mi) => {
        if (achadas[mi]) return;
        const r = acha(visivel, m.texto);
        if (!r || faixas.some((f) => r[0] < f.ate && r[1] > f.de)) return;
        achadas[mi] = true;
        faixas.push({ de: r[0], ate: r[1], rotulo: m.rotulo, aviso: m.aviso });
      });
      faixas.sort((x, y) => x.de - y.de);
      let tag = '';
      let apos = ''; // the tag goes after the label when the label paragraph already carries text
      if (ctx.hipotese) {
        const rot = b.k === 'p' ? rotuloInicial(ns) : null;
        if (rot !== null) {
          emHip = /^hip[óo]teses de alavanca\.?$/i.test(rot);
          if (emHip && textoVisivel(ns.slice(1)).trim()) apos = TAG_HIP;
        } else if (emHip) tag = TAG_HIP;
      }
      return tag + renderNos(ns, ctx, faixas, 0, apos);
    });
    if (b.k === 'p') return `<p>${itens[0]}</p>`;
    return `<${b.k}>${itens.map((x) => `<li>${x}</li>`).join('')}</${b.k}>`;
  }).join('');
  return { html, achadas };
}

/** Renders nodes; `faixas` mark ranges of the visible text of the block, `desde` is the offset of the first node. */
function renderNos(ns: No[], ctx: Contexto, faixas: Faixa[], desde: number, apos = ''): string {
  let pos = desde;
  let tagFeita = !apos;
  const feitas = new Set<Faixa>();
  const texto = (s: string): string => {
    const ini = pos, fim = pos + s.length;
    pos = fim;
    let o = '';
    let p = ini;
    for (const f of faixas) {
      if (f.ate <= p || f.de >= fim) continue;
      const a = Math.max(f.de, p), b = Math.min(f.ate, fim);
      if (a > p) o += esc(s.slice(p - ini, a - ini));
      o += `<span class="flag${f.aviso ? ' av' : ''}">${esc(s.slice(a - ini, b - ini))}</span>`;
      p = b;
      if (b === f.ate && !feitas.has(f)) { feitas.add(f); o += `<span class="flagnote${f.aviso ? ' av' : ''}">${esc(f.rotulo)}</span>`; }
    }
    return o + esc(s.slice(p - ini));
  };
  const nos = (xs: No[]): string => xs.map((n) => {
    switch (n.t) {
      case 'txt': return texto(n.s);
      case 'b': { const r = `<strong>${nos(n.c)}</strong>`; if (!tagFeita) { tagFeita = true; return r + ' ' + apos; } return r; }
      case 'i': return `<em>${nos(n.c)}</em>`;
      case 'a': return `<a href="${esc(n.href)}" target="_blank" rel="noopener noreferrer">${nos(n.c)}</a>`;
      case 'f': {
        const num = ctx.fontes.get(`${n.etapa}:${n.idx}`);
        return num ? `<a class="fref" href="#f${num}" data-to="f${num}" aria-label="Fonte ${num}">${num}</a>` : '<span class="inf">[fonte]</span>';
      }
      case 'inf': return `<span class="inf">[${esc(n.s)}]</span>`;
      case 'm': return `<span class="met">método · ${esc(n.arq)} §${esc(n.sec)}</span>`;
    }
  }).join('');
  return nos(ns);
}

/** Convenience: Markdown to HTML in one step. */
export function mdHTML(md: string, ctx: Contexto): Saida {
  return renderBlocos(blocos(md), ctx);
}
