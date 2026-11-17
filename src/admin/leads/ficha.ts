// Ficha detail view at /admin/leads/{fichaId} (spec 05 §5.4). Phase 3: read-only. The opening (crumb, eyebrow,
// title, lead) is written once and updated in place, so the title that received focus on the route change
// keeps it while the data arrives; the body is redrawn on every Firestore change, keeping the chosen analysis
// version and the open accordions.
import type { Firestore } from 'firebase/firestore';
import { abertura, corpoHTML, esc, portaDoSeletor, rascunhoTexto, uiBarraVazia, versaoExibida, type DadosFicha, type UiBarra } from './detalhe';
import { ACAO_DO_ITEM, definirAvisoLista, tratarErroAcao, type ChamaAcao, type ItemBarra } from './acoes';
import { ouvirFicha } from './dadosFicha';

/** State kept between redraws; `ui` is the action bar's (absent where the bar is not wanted, such as the read-only harness). */
export interface EstadoFicha { versao: string | null; abertos: Set<string>; ui?: UiBarra }
/** What the action bar needs from the shell: the call of `acaoAdmin` and the navigation of the hub. */
export interface ContextoAcoes { chama: ChamaAcao; ir: (caminho: string) => void }

const DUR = 200, EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'; // dur-base, ease-in-out (Design System)

export function montarFicha(alvo: HTMLElement): void {
  alvo.innerHTML = `
    <div class="wrap">
      <div class="vhead">
        <a class="crumb" href="/admin/leads" data-interno>← Leads</a>
        <p class="eyebrow" id="fEb">Ficha</p>
        <h2 id="t-rota" tabindex="-1">Carregando a ficha…</h2>
        <p class="lead" id="fLead"></p>
      </div>
      <div id="fCorpo"></div>
    </div>`;
}

/** Draws the opening and the body; returns nothing. Exported for the local acceptance harness. */
export function desenharFicha(alvo: HTMLElement, d: DadosFicha | null, est: EstadoFicha, hoje: Date): void {
  // "Apagar agora" in flight: the ficha vanishing is the expected end, not an error; the answer takes the page to the list
  if (!d && est.ui?.apagando) return;
  const ab = abertura(d);
  alvo.querySelector('#fEb')!.textContent = ab.eyebrow;
  alvo.querySelector('#t-rota')!.textContent = ab.titulo;
  alvo.querySelector('#fLead')!.textContent = ab.lead;
  const corpo = alvo.querySelector<HTMLElement>('#fCorpo')!;
  if (!d) { corpo.innerHTML = '<p class="empty" style="padding-bottom:var(--space-16)"><a href="/admin/leads" data-interno>Voltar à lista de leads</a></p>'; return; }
  corpo.innerHTML = corpoHTML(d, est.versao, hoje, est.ui);
  corpo.querySelectorAll<HTMLDetailsElement>('details[data-k]').forEach((x) => { x.open = est.abertos.has(x.dataset.k!); });
}

/** Binds the version selector, the accordions and "Copiar rascunho" by delegation; returns the cleanup. */
// Buttons that call the function straight away; the others open a control first (porta, reexecutar, editar, arquivar)
const DIRETAS: ItemBarra[] = ['aprovar', 'resposta', 'mandar'];


export function ligarFicha(alvo: HTMLElement, est: EstadoFicha, redesenhar: () => void, dados: () => DadosFicha | null, acoes?: ContextoAcoes & { id: string }): () => void {
  let vivo = true;
  /** One call at a time: the bar is disabled while it runs ("Aguarde…"); the answer only shows an error (spec 05 §5.7.1). */
  const executar = async (item: ItemBarra, parametros: Record<string, unknown> = {}) => {
    const ui = est.ui;
    if (!acoes || !ui || ui.aguardando) return;
    const acao = ACAO_DO_ITEM[item];
    ui.aguardando = item; ui.erro = null;
    ui.apagando = item === 'arquivar' && parametros.expurgoImediato === true;
    redesenhar();
    try {
      const resposta = await acoes.chama(acoes.id, acao, parametros);
      if (resposta?.estado === 'apagada') {
        if (vivo) { definirAvisoLista('Ficha apagada.'); acoes.ir('/admin/leads'); }
        return;
      }
    } catch (e) {
      ui.apagando = false;
      const r = tratarErroAcao(e, acao);
      if (r.tipo === 'erro') {
        if (r.voltarLista) { if (vivo) { definirAvisoLista(r.texto); acoes.ir('/admin/leads'); } return; }
        ui.erro = r.texto;
      }
    }
    if (!vivo) return;
    ui.apagando = false;
    ui.aguardando = null;
    redesenhar();
    alvo.querySelector<HTMLElement>(`[data-act="${item}"]`)?.focus({ preventScroll: true });
  };
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fechar = (btn: HTMLElement) => {
    const d = document.getElementById(btn.getAttribute('aria-controls')!);
    if (d) d.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    // Version selector (spec 05 §5.9): the field opens its list in place; one tap chooses and closes
    const pick = t.closest<HTMLElement>('.pick');
    if (pick && alvo.contains(pick)) {
      const lista = document.getElementById(pick.getAttribute('aria-controls')!)!;
      if (pick.getAttribute('aria-expanded') === 'true') { fechar(pick); return; }
      // Opening one selector closes the other (spec 05 §5.9)
      alvo.querySelectorAll<HTMLElement>('.pick[aria-expanded="true"]').forEach(fechar);
      lista.hidden = false;
      pick.setAttribute('aria-expanded', 'true');
      if (!reduz) lista.animate([{ height: '0px', opacity: 0 }, { height: lista.scrollHeight + 'px', opacity: 1 }], { duration: DUR, easing: EASE });
      return;
    }
    // Action bar
    const bt = t.closest<HTMLButtonElement>('.actbar [data-act], .acaoerr [data-act]');
    if (bt && alvo.contains(bt) && est.ui) {
      const a = bt.dataset.act as ItemBarra | 'fechar-aviso';
      if (a === 'fechar-aviso') { est.ui.erro = null; redesenhar(); return; }
      if (DIRETAS.includes(a)) { void executar(a); return; }
      const foca = (sel: string) => alvo.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
      if (a === 'porta') { void executar('porta', { porta: portaDoSeletor(dados()!, est.ui) }); return; }
      if (a === ('apagar-agora' as string)) { est.ui.apagarAgora = (bt as unknown as HTMLInputElement).checked; redesenhar(); foca('[data-act="apagar-agora"]'); return; }
      if (a === 'arquivar') { est.ui.confirmando = !est.ui.confirmando; redesenhar(); foca('[data-act="arquivar"]'); return; }
      if (a === ('arquivar-ok' as string)) { est.ui.confirmando = false; void executar('arquivar', { expurgoImediato: est.ui.apagarAgora }); return; }
    }
    const opt = t.closest<HTMLElement>('.pk-opt');
    if (opt && alvo.contains(opt)) {
      const campo = opt.closest('.pk')?.querySelector<HTMLElement>('.pick')?.id;
      if (campo === 'aPorta' && est.ui) { est.ui.porta = opt.dataset.v ?? null; redesenhar(); alvo.querySelector<HTMLElement>('#aPorta')?.focus(); return; }
      est.versao = opt.dataset.v ?? null;
      redesenhar();
      alvo.querySelector<HTMLElement>('#aVer')?.focus();
      return;
    }
    if (!t.closest('.pk')) alvo.querySelectorAll<HTMLElement>('.pick[aria-expanded="true"]').forEach(fechar);

    // Accordions (Design System): height and opacity in dur-base, ease-in-out; no motion when reduced
    const sum = t.closest('summary');
    const det = sum?.parentElement as HTMLDetailsElement | null;
    if (sum && det?.dataset.k && alvo.contains(det)) {
      e.preventDefault();
      const corpo = det.querySelector<HTMLElement>('.body');
      const abrindo = !det.open;
      if (abrindo) est.abertos.add(det.dataset.k); else est.abertos.delete(det.dataset.k);
      if (reduz || !corpo) { det.open = abrindo; return; }
      if (abrindo) det.open = true;
      const h = corpo.scrollHeight;
      const anim = corpo.animate(
        abrindo ? [{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }] : [{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: DUR, easing: EASE },
      );
      anim.onfinish = () => { if (!abrindo) det.open = false; };
      return;
    }

    // Copy the reply draft of the version shown
    const copiar = t.closest<HTMLButtonElement>('[data-act="copiar"]');
    if (copiar) {
      const d = dados();
      const a = d && versaoExibida(d, est.versao);
      const texto = rascunhoTexto(a?.d.rascunhoResposta);
      const feito = (ok: boolean) => { copiar.textContent = ok ? 'Copiado' : 'Não foi possível copiar'; setTimeout(() => { copiar.textContent = 'Copiar rascunho →'; }, 1500); };
      navigator.clipboard?.writeText(texto).then(() => feito(true), () => feito(false)) ?? feito(false);
    }
  };
  const onTecla = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    const b = alvo.querySelector<HTMLElement>('.pick[aria-expanded="true"]');
    if (b) { fechar(b); b.focus(); return; }
    if (est.ui?.confirmando) { est.ui.confirmando = false; redesenhar(); alvo.querySelector<HTMLElement>('[data-act="arquivar"]')?.focus(); }
  };
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onTecla);
  return () => { vivo = false; document.removeEventListener('click', onClick); document.removeEventListener('keydown', onTecla); };
}

export function renderFicha(alvo: HTMLElement, id: string, db: Firestore, acoes?: ContextoAcoes): () => void {
  montarFicha(alvo);
  const est: EstadoFicha = { versao: null, abertos: new Set<string>(), ui: acoes ? uiBarraVazia() : undefined };
  let dados: DadosFicha | null = null;
  let carregou = false;
  const redesenhar = () => { if (carregou) desenharFicha(alvo, dados, est, new Date()); };
  const soltar = ligarFicha(alvo, est, redesenhar, () => dados, acoes && { ...acoes, id });
  const parar = ouvirFicha(
    db, id,
    (d) => { dados = d; carregou = true; redesenhar(); },
    () => {
      alvo.querySelector('#t-rota')!.textContent = 'Ficha';
      alvo.querySelector('#fCorpo')!.innerHTML = `<p class="empty" style="padding-bottom:var(--space-16)">Não foi possível ler a ficha ${esc(id)}. Recarregue a página; se persistir, verifique a sessão.</p>`;
    },
  );
  // Business days left change at midnight: redraw once a minute while the detail is open
  const relogio = setInterval(() => { if (!alvo.querySelector('.pick[aria-expanded="true"]')) redesenhar(); }, 60_000);
  return () => { parar(); soltar(); clearInterval(relogio); };
}
