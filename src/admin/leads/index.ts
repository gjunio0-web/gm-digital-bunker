// Leads module (spec 05, §5). Phase 1 delivers only the shell: the routes exist and resolve,
// and the list, detail and dossier views arrive in phases 2 to 4.
import { collection, getCountFromServer, query, where, type Firestore } from 'firebase/firestore';
import type { ModuloContexto } from '../registro';

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

/** Phase 1 placeholder for /admin/leads, /admin/leads/{fichaId} and /admin/leads/{fichaId}/dossie. */
export function render(alvo: HTMLElement, caminho: string, _ctx: ModuloContexto) {
  const partes = caminho.replace(/^\/admin\/leads\/?/, '').split('/').filter(Boolean);
  const [fichaId, sub] = partes;
  const titulo = !fichaId ? 'Leads' : sub === 'dossie' ? 'Dossiê' : 'Ficha';
  const detalhe = fichaId ? `<p class="login-meta">Ficha ${esc(decodeURIComponent(fichaId))}</p>` : '';
  alvo.innerHTML = `
    <div class="wrap">
      <div class="vhead">
        <a class="crumb" href="/admin" data-interno>← Módulos</a>
        <p class="eyebrow">Módulo · Leads</p>
        <h2 id="t-rota" tabindex="-1">${titulo}</h2>
        <p class="lead">Em construção: esta tela chega nas próximas fases do hub.</p>
        ${detalhe}
      </div>
    </div>`;
}
