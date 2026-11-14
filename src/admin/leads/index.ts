// Leads module (spec 05, §5). The list at /admin/leads (map, method window, filters, ordering) and the
// read-only detail at /admin/leads/{fichaId}, both read in real time from Firestore. The dossier
// (/admin/leads/{fichaId}/dossie) reads the current analysis; the actions arrive in phase 5.
import { collection, getCountFromServer, query, where, type Firestore } from 'firebase/firestore';
import type { ModuloContexto } from '../registro';
import { ouvirFichas, versaoPesos } from './dados';
import { renderDossie } from './dossie';
import { renderFicha } from './ficha';
import { desenhar, ligarControles, montarLista, type EstadoLista } from './lista';
import type { FichaVM } from './regras';

/** Version of the qualification weights that the method window text describes (spec 04 v0.15). */
export const VERSAO_TEXTO = '2';

/** Card status: "Ativo · n fichas · n com erro" (the error part only when there is one). */
export async function status(db: Firestore): Promise<string> {
  const fichas = collection(db, 'fichas');
  const [total, comErro] = await Promise.all([
    getCountFromServer(fichas),
    getCountFromServer(query(fichas, where('erro', '!=', null))),
  ]);
  const n = total.data().count;
  const e = comErro.data().count;
  return `Ativo · ${n} ficha${n === 1 ? '' : 's'}` + (e ? ` · ${e} com erro` : '');
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function render(alvo: HTMLElement, caminho: string, ctx: ModuloContexto): void | (() => void) {
  const partes = caminho.replace(/^\/admin\/leads\/?/, '').split('/').filter(Boolean);
  if (partes.length === 1) return renderFicha(alvo, decodeURIComponent(partes[0]), ctx.db);
  if (partes.length === 2 && partes[1] === 'dossie') return renderDossie(alvo, decodeURIComponent(partes[0]), ctx.db);
  if (partes.length) return emConstrucao(alvo, partes);

  montarLista(alvo);
  const est: EstadoLista = { chave: 'quad', dir: 'desc' };
  let fichas: FichaVM[] = [];
  let carregou = false;
  const redesenhar = () => { if (carregou) desenhar(alvo, fichas, est, new Date()); };
  ligarControles(alvo, est, redesenhar);
  const pararJanela = ligarJanela(alvo, ctx.db);

  const parar = ouvirFichas(
    ctx.db,
    (lista) => { fichas = lista; carregou = true; redesenhar(); },
    () => {
      alvo.querySelector('#leadsList')!.innerHTML =
        '<li><p class="empty" style="padding:var(--space-6) var(--space-2)">Não foi possível ler as fichas. Recarregue a página; se persistir, verifique a sessão.</p></li>';
    },
  );
  // Business days left change at midnight: redraw once a minute while the list is open
  const relogio = setInterval(redesenhar, 60_000);
  return () => { parar(); clearInterval(relogio); pararJanela(); };
}

// ---------- Method window (spec 05 §5.8; guide v1.2 §7) ----------
export function ligarJanela(alvo: HTMLElement, db: Firestore | null): () => void {
  const dlg = document.getElementById('metodoDlg') as HTMLDialogElement | null;
  const abrir = alvo.querySelector<HTMLButtonElement>('#openMetodo');
  const fechar = document.getElementById('closeMetodo') as HTMLButtonElement | null;
  if (!dlg || !abrir || !fechar) return () => undefined;

  const aviso = document.getElementById('metodoVersao');
  if (db) versaoPesos(db).then((v) => {
    if (!aviso || v === null || v === VERSAO_TEXTO) return;
    aviso.textContent = `Esta explicação descreve a versão ${VERSAO_TEXTO} dos pesos; a configuração está na versão ${esc(v)}. Os números podem ter mudado.`;
    aviso.hidden = false;
  });

  const onAbrir = () => {
    dlg.showModal();
    dlg.querySelector<HTMLElement>('.mdlg-bd')!.scrollTop = 0;
    fechar.focus();
  };
  const onFechar = () => dlg.close();
  const onFora = (e: MouseEvent) => { if (e.target === dlg) dlg.close(); };
  const onClose = () => { if (abrir.isConnected) abrir.focus(); };
  abrir.addEventListener('click', onAbrir);
  fechar.addEventListener('click', onFechar);
  dlg.addEventListener('click', onFora);
  dlg.addEventListener('close', onClose);
  ligarAcordeoes(dlg);
  return () => {
    fechar.removeEventListener('click', onFechar);
    dlg.removeEventListener('click', onFora);
    dlg.removeEventListener('close', onClose);
    if (dlg.open) dlg.close();
  };
}

/** Design System accordion: height and opacity in dur-base, ease-in-out; no motion when reduced. */
function ligarAcordeoes(raiz: HTMLElement) {
  if (raiz.dataset.acordeoes) return;
  raiz.dataset.acordeoes = '1';
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  raiz.querySelectorAll<HTMLDetailsElement>('.facc details').forEach((d) => {
    const sum = d.querySelector('summary')!, corpo = d.querySelector<HTMLElement>('.body');
    let anim: Animation | null = null;
    sum.addEventListener('click', (e) => {
      if (!corpo) return;
      e.preventDefault();
      if (reduz) { d.open = !d.open; return; }
      anim?.cancel();
      const abrindo = !d.open;
      if (abrindo) d.open = true;
      const h = corpo.scrollHeight;
      anim = corpo.animate(
        abrindo ? [{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }] : [{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }, // dur-base, ease-in-out
      );
      anim.onfinish = () => { if (!abrindo) d.open = false; anim = null; };
    });
  });
}

/** Placeholder for /admin/leads/{fichaId}/dossie until phase 4. */
function emConstrucao(alvo: HTMLElement, partes: string[]) {
  const [fichaId, sub] = partes;
  const titulo = sub === 'dossie' ? 'Dossiê' : 'Ficha';
  alvo.innerHTML = `
    <div class="wrap">
      <div class="vhead">
        <a class="crumb" href="${sub === 'dossie' ? `/admin/leads/${encodeURIComponent(decodeURIComponent(fichaId))}` : '/admin/leads'}" data-interno>${sub === 'dossie' ? '← Ficha' : '← Leads'}</a>
        <p class="eyebrow">Módulo · Leads</p>
        <h2 id="t-rota" tabindex="-1">${titulo}</h2>
        <p class="lead">Em construção: esta tela chega nas próximas fases do hub.</p>
        <p class="login-meta">Ficha ${esc(decodeURIComponent(fichaId))}</p>
      </div>
    </div>`;
}
