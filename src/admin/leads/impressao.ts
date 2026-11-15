// Dossier print / "Salvar PDF" (spec 05 §5.6 v1.18; guide v1.6). No PDF library: the file comes from the browser's
// own print dialog, laid out by `@media print` in leads.css. This module owns what CSS cannot know: the file name
// (the page title during printing), the running header and footer (page margin boxes, written with the company
// and the generation time just before printing) and the generation date and time shown in the body.
import { horaSP } from './detalhe';
import { dataLonga } from './regras';

/** "AAAA-MM-DD" of the São Paulo calendar day. */
export function dataISO(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p; // en-CA formats as YYYY-MM-DD
}

/** Company name as a file-name part: no accents, letters and digits joined by hyphens, at most 50 characters. */
export function slugArquivo(s: string): string {
  const t = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
  return t || 'ficha';
}

/** "Dossie-⟨empresa⟩-vN-⟨AAAA-MM-DD⟩" – the browser adds ".pdf"; the person's name is never part of it. */
export function nomeArquivo(empresa: string, versao: string, hoje: Date): string {
  return `Dossie-${slugArquivo(empresa)}-${slugArquivo(versao)}-${dataISO(hoje)}`;
}

/** A CSS string literal: quotes, backslashes and line breaks neutralised. */
export function cssStr(s: string): string {
  return '"' + s.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ') + '"';
}

export interface InfoImpressao { empresa: string; versao: string }

/**
 * The page margin boxes. From page 2 on, a header ("GM Digital Bunker™ · Dossiê · empresa · análise vN" and
 * "Confidencial · uso interno"); on every page a footer ("Gerado em … às … · gmdigitalbunker.com.br" and
 * "página n de N"). Chrome and Edge print margin boxes; Safari and Firefox may not (hypothesis, to confirm),
 * which is why the date and the signature are also in the body.
 */
export function folhaMargens(info: InfoImpressao, agora: Date, mono: string): string {
  const fonte = `font:500 7.5pt/1.4 ${mono}; color:#5a626e; letter-spacing:.04em;`;
  const cab = `${fonte} vertical-align:bottom; padding-bottom:2.5mm; margin-bottom:5mm; border-bottom:.5pt solid #dadde2;`;
  const rod = `${fonte} vertical-align:top; padding-top:2.5mm; margin-top:5mm; border-top:.5pt solid #dadde2;`;
  const gerado = `Gerado em ${dataLonga(agora)} às ${horaSP(agora)} · gmdigitalbunker.com.br`;
  return `@page{size:A4; margin:26mm 18mm 22mm;
  @top-left{content:${cssStr(`GM Digital Bunker™ · Dossiê · ${info.empresa} · análise ${info.versao}`)}; width:66%; ${cab} white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  @top-right{content:"Confidencial · uso interno"; width:34%; text-align:right; white-space:nowrap; ${cab}}
  @bottom-left{content:${cssStr(gerado)}; width:70%; ${rod}}
  @bottom-right{content:"página " counter(page) " de " counter(pages); width:30%; text-align:right; ${rod}}
}
@page :first{
  margin-top:14mm;
  @top-left{content:none; border:0}
  @top-right{content:none; border:0}
}`;
}

/**
 * Binds printing to the dossier on screen: "Salvar PDF" buttons, and Ctrl/Cmd+P through the print events.
 * `info()` returns the company and version of the analysis shown, or null when there is none to print.
 * Returns the cleanup.
 */
export function ligarImpressao(alvo: HTMLElement, info: () => InfoImpressao | null): { imprimir: () => Promise<void>; soltar: () => void } {
  let tituloOriginal: string | null = null;
  let folha: HTMLStyleElement | null = null;

  const preencher = (agora: Date) => {
    alvo.querySelectorAll<HTMLElement>('.pdate').forEach((e) => { e.textContent = dataLonga(agora); });
    alvo.querySelectorAll<HTMLElement>('.pgen').forEach((e) => { e.textContent = `${dataLonga(agora)} às ${horaSP(agora)}`; });
  };
  const antes = () => {
    const i = info();
    if (!i) return;
    const agora = new Date();
    preencher(agora);
    if (tituloOriginal === null) tituloOriginal = document.title;
    document.title = nomeArquivo(i.empresa, i.versao, agora);
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace';
    folha?.remove();
    folha = document.createElement('style');
    folha.id = 'folhaPdf';
    folha.textContent = folhaMargens(i, agora, mono);
    document.head.appendChild(folha);
  };
  const depois = () => {
    if (tituloOriginal !== null) { document.title = tituloOriginal; tituloOriginal = null; }
    folha?.remove(); folha = null;
  };
  addEventListener('beforeprint', antes);
  addEventListener('afterprint', depois);

  const imprimir = async () => {
    if (!info()) return;
    antes(); // also for browsers that do not fire the event on window.print()
    try { await document.fonts?.ready; } catch { /* print anyway */ }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    print();
  };
  const onClick = (e: MouseEvent) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act="pdf"]');
    if (!b || !alvo.contains(b)) return;
    e.preventDefault();
    void imprimir();
  };
  alvo.addEventListener('click', onClick);
  return {
    imprimir,
    soltar: () => { removeEventListener('beforeprint', antes); removeEventListener('afterprint', depois); alvo.removeEventListener('click', onClick); depois(); },
  };
}
