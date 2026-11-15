// Dossier at /admin/leads/{fichaId}/dossie (spec 05 §5.6; guide v1.4 §5.3). Phase 4a: the reading screen –
// opening, pendency banner, section index, s0 to s8, marks, "hipótese" tag and underlined findings. Phase 4b:
// the mobile section bar and list (painelSecoes.ts) and "Salvar PDF" (impressao.ts; the signature block and the
// source addresses below are only visible in print). Pure builders (documents in, HTML out) plus the view.
import type { Firestore } from 'firebase/firestore';
import { combinacaoTxt, ehAviso, esc, horaSP, versaoDesc, type Analise, type DadosDossie } from './detalhe';
import { ouvirDossie } from './dadosFicha';
import { ligarImpressao, type InfoImpressao } from './impressao';
import { mdHTML, urlSegura, type Marca } from './markdown';
import { ligarPainelSecoes } from './painelSecoes';
import { CARGO, CONF, ESTADO, dataLonga } from './regras';
import { ETAPA_COLETA, MAX_PORTE, MAX_TECNOLOGIA, PEND_TIPO, PORTA, TECNOLOGIA, porteTxt } from './rotulos';

type Obj = Record<string, any>;
const isDate = (x: unknown): x is Date => x instanceof Date && !isNaN(x.getTime());

/** Fixed section titles (spec 02, 3.3) and the shorter names of the index (mock-up). */
const TITULO: Record<string, string> = {
  s0: 'Cabeçalho', s1: 'Qualificação imediata', s2: 'A empresa', s3: 'Setor', s4: 'Potencial de mercado', s5: 'Pessoas',
  s6: 'Enquadramento', s7: 'Preparação da primeira conversa', s8: 'Fontes',
};
const INDICE: Record<string, string> = { ...TITULO, s7: 'Primeira conversa' };
export const SECOES = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

// ---------- Sources (s8) ----------
export interface Fonte { n: number; etapa: string; idx: number | null; titulo: string; url: string | null; tipo: string; data: string }

/**
 * Reads the s8 text the pipeline writes (`### etapa` headings and "- [F:etapa:i] [titulo](url) – tipo, data"
 * items). Numbers follow the list order. A line that does not fit the format is kept as a source without link.
 */
export function fontesDoS8(corpo: string | null | undefined): { lista: Fonte[]; mapa: Map<string, number> } {
  const lista: Fonte[] = [];
  const mapa = new Map<string, number>();
  let etapa = '';
  for (const bruta of String(corpo ?? '').split('\n')) {
    const l = bruta.trim();
    let m: RegExpExecArray | null;
    if ((m = /^#{1,6}\s+(.+)$/.exec(l))) { etapa = m[1].trim(); continue; }
    if (!(m = /^[-*]\s+(.*)$/.exec(l))) continue;
    const item = m[1];
    const f = /^\[F:([a-z_]+):(\d+)\]\s+\[(.*?)\]\((.+?)\)(?:\s+–\s+([^,]*?))?(?:,\s*(\d{4})-(\d{2})-(\d{2}))?\s*$/.exec(item);
    const n = lista.length + 1;
    if (f) {
      const data = f[6] ? dataLonga(new Date(Date.UTC(+f[6], +f[7] - 1, +f[8], 15))) : '';
      lista.push({ n, etapa: f[1], idx: Number(f[2]), titulo: f[3], url: urlSegura(f[4]) ? f[4] : null, tipo: f[5] ?? '', data });
      mapa.set(`${f[1]}:${f[2]}`, n);
    } else {
      lista.push({ n, etapa, idx: null, titulo: item.replace(/\[F:[a-z_]+:\d+\]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim(), url: null, tipo: '', data: '' });
    }
  }
  return { lista, mapa };
}
const fontesHTML = (lista: Fonte[]) =>
  '<ol class="fontes">' + lista.map((x) => {
    const t = x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.titulo)}</a>` : esc(x.titulo);
    const meta = [ETAPA_COLETA[x.etapa] ?? x.etapa, x.tipo, x.data].filter(Boolean).join(' · ');
    // The full address is shown only in print (the PDF has no clickable page behind it)
    return `<li id="f${x.n}"><b>${x.n}</b><span>${t}${meta ? `<small>${esc(meta)}</small>` : ''}${x.url ? `<small class="furl">${esc(x.url)}</small>` : ''}</span></li>`;
  }).join('') + '</ol>';

// ---------- Findings ----------
/** Open finding: no treatment "corrigida" nor "sem_alteracao" (spec 05 v1.13); number warnings are apart. */
export const emAberto = (p: Obj) => !ehAviso(p) && p.tratamento !== 'corrigida' && p.tratamento !== 'sem_alteracao';
function marcasDaSecao(a: Analise, secao: string): Marca[] {
  return ((a.d.verificacao?.pendencias ?? []) as Obj[])
    .filter((p) => p.secao === secao && (ehAviso(p) || emAberto(p)))
    .map((p) => ({
      texto: String(p.trecho ?? p.texto ?? ''),
      aviso: ehAviso(p),
      rotulo: ehAviso(p) ? 'Aviso – número sem fonte' : `Pendência de ${PEND_TIPO[p.tipo] ?? p.tipo}`,
    }))
    .filter((m) => m.texto.trim());
}
/** Banner above the sections; `achadas` is how many open findings were underlined in the text below (spec 05 v1.17). */
export function bannerHTML(a: Analise, id: string, achadas: number): string {
  const abertas = ((a.d.verificacao?.pendencias ?? []) as Obj[]).filter(emAberto);
  const n = abertas.length;
  if (!n) return '';
  const nEsc = abertas.filter((p) => p.tipo === 'escopo').length;
  const ficha = `<a href="/admin/leads/${encodeURIComponent(id)}" data-interno>ficha</a>`;
  const plural = n > 1;
  const inicio = `Esta versão tem ${n} pendência${plural ? 's' : ''} da verificação em aberto${nEsc ? `, ${nEsc} de escopo` : ''}. `;
  const resto = achadas >= n
    ? `${plural ? 'Os trechos apontados estão sublinhados' : 'O trecho apontado está sublinhado'}; as correções sugeridas estão na ${ficha}.`
    : (achadas === 0
        ? `Nenhum trecho está sublinhado no texto abaixo: ${plural ? 'eles estão' : 'ele está'} no rascunho de resposta, no bloco de Enquadramento ou em passagens que o texto não traz iguais.`
        : `${achadas} de ${n} trechos estão sublinhados no texto abaixo; ${n - achadas === 1 ? 'o outro está' : 'os demais estão'} no rascunho de resposta, no bloco de Enquadramento ou em passagens que o texto não traz iguais.`)
      + ` Veja ${plural ? 'as pendências' : 'a pendência'} e as correções sugeridas na ${ficha}.`;
  return `<p class="dbanner">${inicio}${resto}</p>`;
}

// ---------- Opening ----------
export const analiseAtual = (d: DadosDossie): Analise | null =>
  d.analises.find((x) => x.id === d.f.analiseAtual) ?? d.analises[0] ?? null;

export function aberturaDossie(d: DadosDossie | null): { eyebrow: string; titulo: string; lead: string } {
  if (!d) return { eyebrow: 'Dossiê', titulo: 'Ficha não encontrada', lead: 'Esta ficha não existe ou já foi excluída pelo prazo de guarda.' };
  const f = d.f, o = f.original ?? {};
  const a = analiseAtual(d);
  const cargo = CARGO[o.cargo] ?? String(o.cargo ?? '');
  return {
    eyebrow: ['Dossiê', a ? `análise ${a.id}` : 'sem análise', ESTADO[f.estado] ?? String(f.estado ?? '')].join(' · '),
    titulo: String(o.empresa || o.nome || ''),
    lead: o.nome ? `Análise preliminar para a primeira conversa com ${o.nome}${cargo ? `, ${cargo}` : ''}.` : '',
  };
}

// ---------- s0 and s6 (made by the hub from fields) ----------
function portaTxt(a: Analise): string {
  const e = a.d.enquadramento;
  const p = e?.portaProvavel;
  if (!p) return 'Nenhuma';
  const s = p === 'combinacao' ? (combinacaoTxt(a) ? `Combinação – ${combinacaoTxt(a)}` : 'Combinação (não detalhada)') : PORTA[p] ?? String(p);
  const alt = e.detalhe?.porta?.alternativa;
  return s + (alt ? ` · alternativa: ${alt}` : '');
}
function metodoTxt(a: Analise): string {
  const v = a.d.versaoMetodo ?? /\*\*Método:\*\*\s*versão\s+(\S+)/.exec(String(a.d.secoes?.s0?.corpo ?? ''))?.[1];
  return v ? `versão ${v}` : '–';
}
function s0HTML(d: DadosDossie, a: Analise): string {
  const f = d.f, o = f.original ?? {}, l = f.lead;
  const par: [string, string][] = [
    ['Empresa', String(o.empresa ?? '–')],
    ['Signatário', [o.nome, CARGO[o.cargo] ?? o.cargo].filter(Boolean).join(' · ') || '–'],
    ['Recebida', (isDate(f.recebidaEm) ? `${dataLonga(f.recebidaEm)} ${horaSP(f.recebidaEm)}` : '–') + (f.origem?.pagina ? ` · página de origem ${f.origem.pagina}` : '')],
    ['Análise', `${a.id} · ${versaoDesc(a)}`],
    ['Método', metodoTxt(a)],
    ['Qualificação', l?.grau ? `Grau ${l.grau} · ${l.pontos} pontos · confiança ${CONF[l.modificadores?.confianca as keyof typeof CONF] ?? '–'}` : '–'],
    ['Porta provável', portaTxt(a)],
    ['Estado', ESTADO[f.estado] ?? String(f.estado ?? '–')],
  ];
  return '<dl class="dkv">' + par.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';
}
function aderenciaHTML(f: Obj): string {
  const ad = f.lead?.eixos?.aderencia;
  if (!ad) return '';
  const porte = ad.porte ?? {}, tec = ad.tecnologia ?? {};
  const txt = `${Number(ad.pontos ?? 0)} de ${Number(ad.maximo ?? 30)} – ${porteTxt(porte.categoria, porte.fonteFuncionarios)} (${Number(porte.pontos ?? 0)} de ${MAX_PORTE}); ` +
    `${TECNOLOGIA[tec.categoria] ?? String(tec.categoria ?? '')} (${Number(tec.pontos ?? 0)} de ${MAX_TECNOLOGIA})`;
  return `<dl class="dkv" style="margin-bottom:var(--space-4)"><dt>Aderência</dt><dd>${esc(txt)}</dd></dl>`;
}

// ---------- s7: the conversation block ----------
const ehHipotese = (x: unknown) => /^hip[óo]tese/i.test(String(x ?? '').trim());
function conversaHTML(a: Analise, ctx: { fontes: Map<string, number> }): string {
  const c = a.d.conversa;
  if (!c) return '';
  const ni = (s: unknown) => mdHTML(String(s ?? ''), { fontes: ctx.fontes, marcas: [], hipotese: false }).html.replace(/^<p>|<\/p>$/g, '');
  const perg = ((c.perguntas ?? []) as Obj[]).map((q) => `<li>${ehHipotese(q.lacunaOuHipotese) ? '<span class="hip">hipótese</span>' : ''}${ni(q.pergunta)}</li>`).join('');
  const mat = ((c.materiais ?? []) as Obj[]).map((m) => {
    const nome = urlSegura(String(m.url ?? '')) ? `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.nome)}</a>` : esc(m.nome);
    return `<li>${nome}${m.porQue ? ` – ${esc(m.porQue)}` : ''}</li>`;
  }).join('');
  const pts = ((c.pontosDeAtencao ?? []) as unknown[]).map((x) => `<li>${ni(x)}</li>`).join('');
  return (perg ? `<p><strong>Perguntas</strong></p><ol>${perg}</ol>` : '') +
    (mat ? `<p><strong>Materiais</strong></p><ul>${mat}</ul>` : '') +
    (pts ? `<p><strong>Pontos de atenção</strong></p><ul>${pts}</ul>` : '');
}

// ---------- Print signature (visible only in print) ----------
/** Closing block of the PDF; the generation date and time (`.pgen`) are filled just before printing. */
export function assinaturaHTML(a: Analise): string {
  const criada = a.d.criadaEm;
  const dataAnalise = isDate(criada) ? ` · ${dataLonga(criada)} ${horaSP(criada)}` : '';
  return '<div class="psign" aria-hidden="true">' +
    '<p class="pbrand">GM Digital Bunker™</p>' +
    '<p class="plema">Estratégia de tecnologia em IA para o mundo real.</p>' +
    '<dl class="dkv">' +
    '<dt>Gerado em</dt><dd class="pgen"></dd>' +
    `<dt>Análise</dt><dd>${esc(a.id + dataAnalise)}</dd>` +
    `<dt>Método</dt><dd>${esc(metodoTxt(a))}</dd>` +
    '<dt>Domínio</dt><dd>gmdigitalbunker.com.br</dd></dl>' +
    '<p class="pnota">Análise preliminar gerada a partir de fontes públicas e dos dados do formulário de contato. Documento de uso interno: não encaminhar ao contato.</p></div>';
}

// ---------- Body ----------
export interface DossieHTML { indice: string; corpo: string; pendencias: { total: number; achadas: number } }

export function indiceHTML(): string {
  return '<ol>' + SECOES.map((k) => `<li><a href="#d-${k}" data-to="d-${k}"><span>${k}</span>${esc(INDICE[k])}</a></li>`).join('') + '</ol>';
}

export function dossieHTML(d: DadosDossie): DossieHTML {
  const a = analiseAtual(d);
  if (!a) {
    return { indice: '', corpo: '<p class="empty">Esta ficha ainda não tem análise. O dossiê aparece quando a análise terminar.</p>', pendencias: { total: 0, achadas: 0 } };
  }
  const secoes: Obj = a.d.secoes ?? {};
  const { lista, mapa } = fontesDoS8(secoes.s8?.corpo);
  let total = 0, achadas = 0;
  const sec = (k: string, conteudo: string) => `<section class="dsec" id="d-${k}"><p class="eb3">${k}</p><h3>${esc(TITULO[k])}</h3>${conteudo}</section>`;
  const vazia = (k: string) => `<p class="empty">${esc(secoes[k]?.motivoVazia || 'Seção vazia.')}</p>`;
  let abertasAchadas = 0;
  let h = sec('s0', s0HTML(d, a));
  for (const k of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) {
    const s: Obj | undefined = secoes[k];
    if (!s || s.vazia || !String(s.corpo ?? '').trim()) {
      h += sec(k, (k === 's6' ? aderenciaHTML(d.f) : '') + vazia(k) + (k === 's7' ? conversaHTML(a, { fontes: mapa }) : ''));
      continue;
    }
    const marcas = marcasDaSecao(a, k);
    const r = mdHTML(String(s.corpo), { fontes: mapa, marcas, hipotese: k === 's6' });
    total += marcas.length;
    achadas += r.achadas.filter(Boolean).length;
    abertasAchadas += r.achadas.filter((x, i) => x && !marcas[i].aviso).length;
    h += sec(k, (k === 's6' ? aderenciaHTML(d.f) : '') + r.html + (k === 's7' ? conversaHTML(a, { fontes: mapa }) : ''));
  }
  h += sec('s8', lista.length ? fontesHTML(lista) : vazia('s8'));
  return { indice: indiceHTML(), corpo: bannerHTML(a, d.id, abertasAchadas) + h + assinaturaHTML(a), pendencias: { total, achadas } };
}

// ---------- View ----------
export function rolarPara(el: HTMLElement | null, reduz: boolean): void {
  if (!el) return;
  // window.scrollTo, never scrollIntoView (spec 05 §5.6, scrolling rules)
  const cab = document.querySelector('header.site');
  const folga = (cab ? cab.getBoundingClientRect().height : 0) + 16;
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - folga), behavior: reduz ? 'auto' : 'smooth' });
}

export function montarDossie(alvo: HTMLElement, id: string): void {
  alvo.innerHTML = `
    <div class="wrap">
      <div class="pmast" aria-hidden="true"><span class="pbrand">GM Digital Bunker™</span><span class="pmeta">Dossiê de análise preliminar · <span class="pdate"></span> · confidencial · uso interno</span></div>
      <div class="vhead">
        <a class="crumb" href="/admin/leads/${encodeURIComponent(id)}" data-interno>← Ficha</a>
        <p class="eyebrow" id="dEb">Dossiê</p>
        <h2 id="t-rota" tabindex="-1">Carregando o dossiê…</h2>
        <p class="lead" id="dLead"></p>
        <div class="dact" id="dAct" hidden><button class="btn secondary" type="button" data-act="pdf">Salvar PDF</button></div>
      </div>
      <div class="dos">
        <nav class="dindex" id="dIndice" aria-label="Seções do dossiê" hidden></nav>
        <div class="dbody" id="dCorpo"></div>
      </div>
    </div>`;
}

/** Draws the opening and the body. Exported for the local acceptance harness. */
export function desenharDossie(alvo: HTMLElement, d: DadosDossie | null): DossieHTML | null {
  const ab = aberturaDossie(d);
  alvo.querySelector('#dEb')!.textContent = ab.eyebrow;
  alvo.querySelector('#t-rota')!.textContent = ab.titulo;
  alvo.querySelector('#dLead')!.textContent = ab.lead;
  const indice = alvo.querySelector<HTMLElement>('#dIndice')!;
  const corpo = alvo.querySelector<HTMLElement>('#dCorpo')!;
  if (!d) {
    indice.hidden = true;
    alvo.querySelector<HTMLElement>('#dAct')!.hidden = true;
    corpo.innerHTML = '<p class="empty" style="padding-bottom:var(--space-16)"><a href="/admin/leads" data-interno>Voltar à lista de leads</a></p>';
    return null;
  }
  const r = dossieHTML(d);
  alvo.querySelector<HTMLElement>('#dAct')!.hidden = !analiseAtual(d);
  indice.innerHTML = r.indice;
  indice.hidden = !r.indice;
  corpo.innerHTML = r.corpo;
  return r;
}

export function renderDossie(alvo: HTMLElement, id: string, db: Firestore): () => void {
  montarDossie(alvo, id);
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // "Salvar PDF" on the ficha opens this screen with ?imprimir=1: print once the first draw is done, then
  // drop the flag from the address so that a reload does not print again
  let pedirImpressao = new URLSearchParams(location.search).get('imprimir') === '1';
  if (pedirImpressao) history.replaceState(history.state, '', location.pathname);
  let atual: InfoImpressao | null = null;
  const imp = ligarImpressao(alvo, () => atual);
  const painel = ligarPainelSecoes(alvo, (el) => rolarPara(el, reduz));
  // Index links and source marks scroll the window to the target; the address does not change
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-to]');
    if (!a || !alvo.contains(a)) return;
    e.preventDefault();
    rolarPara(document.getElementById(a.dataset.to!), reduz);
  };
  alvo.addEventListener('click', onClick);
  const parar = ouvirDossie(
    db, id,
    (d) => {
      desenharDossie(alvo, d);
      const a = d && analiseAtual(d);
      atual = d && a ? { empresa: String(d.f.original?.empresa || d.f.original?.nome || 'ficha'), versao: a.id } : null;
      if (pedirImpressao) { pedirImpressao = false; if (atual) void imp.imprimir(); }
    },
    () => {
      atual = null;
      alvo.querySelector('#t-rota')!.textContent = 'Dossiê';
      alvo.querySelector<HTMLElement>('#dAct')!.hidden = true;
      alvo.querySelector('#dCorpo')!.innerHTML = `<p class="empty" style="padding-bottom:var(--space-16)">Não foi possível ler o dossiê da ficha ${esc(id)}. Recarregue a página; se persistir, verifique a sessão.</p>`;
    },
  );
  return () => { parar(); painel(); imp.soltar(); alvo.removeEventListener('click', onClick); };
}
