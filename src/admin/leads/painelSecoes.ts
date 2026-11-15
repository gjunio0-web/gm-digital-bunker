// Dossier section bar and section list below 1024px (spec 05 v1.10 to v1.12, §5.6; guide v1.5). The bar is
// fixed at the foot of the screen; it shows while the index at the top is out of view and the page footer is
// not. A tap opens the list, a drawer that slides up from the bottom edge, with a veil, a handle and
// drag-down to close. Closing by any means has the same effect: unlocks scrolling, consumes the history
// entry the list pushed and gives the focus back to the bar.
import { definirGanchoVoltar } from '../historico';

/** Result of a drag, from its distance (px), duration (ms): close above 80px, or from 24px when fast. */
export function arrasteFecha(dy: number, ms: number): boolean {
  const v = dy / Math.max(1, ms);
  return dy > 80 || (dy > 24 && v > 0.5);
}

/** The reading section: the last whose start already passed the lower edge of the fixed header (+40px). */
export function secaoEmLeitura(secoes: { id: string; top: number }[], limite: number): string {
  let atual = secoes[0]?.id ?? 'd-s0';
  for (const s of secoes) if (s.top < limite) atual = s.id;
  return atual;
}

const X = '<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * Builds the bar, the veil and the list and binds them. `rolar` scrolls the window to an element (the dossier's
 * own scroll, never scrollIntoView). Returns the cleanup, which also gives the scroll back if the list is open.
 */
export function ligarPainelSecoes(alvo: HTMLElement, rolar: (el: HTMLElement | null) => void): () => void {
  const indice = alvo.querySelector<HTMLElement>('#dIndice')!;
  const rodape = document.querySelector<HTMLElement>('footer.site');

  const barra = document.createElement('div');
  barra.className = 'dbar';
  barra.innerHTML = '<button class="btn secondary" type="button" tabindex="-1" aria-expanded="false" aria-controls="secPanel">☰ Seções do dossiê</button>';
  const botao = barra.querySelector<HTMLButtonElement>('button')!;
  const veu = document.createElement('div');
  veu.className = 'secp-veil';
  const painel = document.createElement('div');
  painel.className = 'secp';
  painel.id = 'secPanel';
  painel.setAttribute('role', 'dialog');
  painel.setAttribute('aria-modal', 'true');
  painel.setAttribute('aria-label', 'Seções do dossiê');
  document.body.append(barra, veu, painel);
  document.body.classList.add('dos-on');

  // ----- Bar visibility: index out of view above, footer not in view -----
  let indiceFora = false, rodapeVisto = false;
  const aberto = () => painel.classList.contains('on');
  const atualizarBarra = () => {
    const ligada = indiceFora && !rodapeVisto && !indice.hidden;
    barra.classList.toggle('on', ligada);
    botao.tabIndex = ligada ? 0 : -1;
  };
  let observadores: IntersectionObserver[] = [];
  if ('IntersectionObserver' in window) {
    const oi = new IntersectionObserver((es) => { indiceFora = !es[0].isIntersecting && es[0].boundingClientRect.top < 0; atualizarBarra(); });
    oi.observe(indice);
    observadores.push(oi);
    if (rodape) {
      const orp = new IntersectionObserver((es) => { rodapeVisto = es[0].isIntersecting; atualizarBarra(); });
      orp.observe(rodape);
      observadores.push(orp);
    }
  }

  // ----- Open and close -----
  let abridor: HTMLElement | null = null;
  let entradaNoHistorico = false;
  let depois: (() => void) | null = null;

  const emLeitura = () => {
    const cab = document.querySelector('header.site');
    const limite = (cab ? cab.getBoundingClientRect().height : 0) + 40;
    return secaoEmLeitura(Array.from(alvo.querySelectorAll<HTMLElement>('.dsec[id^="d-s"]')).map((s) => ({ id: s.id, top: s.getBoundingClientRect().top })), limite);
  };
  const abrir = (de: HTMLElement) => {
    const links = Array.from(indice.querySelectorAll<HTMLAnchorElement>('a[data-to]'));
    if (!links.length) return;
    abridor = de;
    const atual = emLeitura();
    painel.innerHTML = `<div class="grab" aria-hidden="true"><i></i></div><div class="sh"><p>Seções do dossiê</p><button class="btn icon" type="button" data-close aria-label="Fechar">${X}</button></div><ul>` +
      links.map((a) => {
        const id = a.dataset.to!, on = id === atual;
        return `<li><button type="button" data-go="${id}"${on ? ' aria-current="true"' : ''}>${a.innerHTML}${on ? '<small>você está aqui</small>' : ''}</button></li>`;
      }).join('') + '</ul>';
    painel.scrollTop = 0;
    veu.classList.add('on');
    painel.classList.add('on');
    de.setAttribute('aria-expanded', 'true');
    // Lock the page behind the list; the Android "back" button closes the list through a history entry of its own
    document.documentElement.style.overflow = 'hidden';
    try { history.pushState({ secp: 1 }, '', location.href); entradaNoHistorico = true; } catch { entradaNoHistorico = false; }
    (painel.querySelector<HTMLElement>('[aria-current]') ?? painel.querySelector<HTMLElement>('[data-go]'))?.focus({ preventScroll: true });
  };
  const fechar = (aoFim?: () => void, vindoDoVoltar = false) => {
    if (!aberto()) return;
    veu.classList.remove('on');
    painel.classList.remove('on');
    veu.style.opacity = '';
    // After a drag the list leaves from where the finger let go: the inline position is dropped one frame
    // later, so the close transition runs from it to the bottom edge
    requestAnimationFrame(() => { painel.style.transform = ''; });
    abridor?.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
    const proximo = aoFim ?? (() => abridor?.focus({ preventScroll: true }));
    // Consume the history entry first; scroll or focus only once the back navigation has settled
    if (entradaNoHistorico && !vindoDoVoltar) { entradaNoHistorico = false; depois = proximo; history.back(); }
    else { entradaNoHistorico = false; proximo(); }
  };
  definirGanchoVoltar(() => {
    if (depois) { const f = depois; depois = null; setTimeout(f, 0); return true; }
    if (aberto()) { fechar(undefined, true); return true; }
    return false;
  });

  botao.addEventListener('click', () => abrir(botao));
  veu.addEventListener('click', () => fechar());
  painel.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-close]')) { fechar(); return; }
    const ir = t.closest<HTMLElement>('[data-go]');
    if (!ir) return;
    const destino = document.getElementById(ir.dataset.go!);
    fechar(() => rolar(destino));
  });
  const onTecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && aberto()) fechar(); };
  document.addEventListener('keydown', onTecla);
  // Above 1024px the bar is not shown; a list left open (rotated tablet) closes with it
  const larga = matchMedia('(min-width: 1024px)');
  const onLarga = () => { if (larga.matches && aberto()) fechar(); };
  larga.addEventListener('change', onLarga);

  // ----- Drag down to close: from the handle or header always; from the list only when it is at the top -----
  let y0: number | null = null, dy = 0, t0 = 0;
  painel.addEventListener('touchstart', (e) => {
    if (!aberto() || e.touches.length !== 1) return;
    const noTopo = !!(e.target as Element).closest('.grab,.sh');
    if (!noTopo && painel.scrollTop > 0) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
  }, { passive: true });
  painel.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    let d = e.touches[0].clientY - y0;
    if (d <= 0) { if (dy === 0) { y0 = null; return; } d = 0; }
    e.preventDefault();
    dy = d;
    painel.classList.add('drag');
    painel.style.transform = `translateY(${d}px)`;
    veu.style.opacity = String(Math.max(0, 1 - d / (painel.offsetHeight || 1)));
  }, { passive: false });
  const soltar = () => {
    if (y0 === null) return;
    const d = dy, ms = Date.now() - t0;
    y0 = null;
    painel.classList.remove('drag');
    if (arrasteFecha(d, ms)) fechar();
    else { painel.style.transform = ''; veu.style.opacity = ''; }
  };
  painel.addEventListener('touchend', soltar);
  painel.addEventListener('touchcancel', soltar);

  return () => {
    observadores.forEach((o) => o.disconnect());
    observadores = [];
    document.removeEventListener('keydown', onTecla);
    larga.removeEventListener('change', onLarga);
    definirGanchoVoltar(null);
    document.documentElement.style.overflow = '';
    document.body.classList.remove('dos-on');
    barra.remove(); veu.remove(); painel.remove();
  };
}
