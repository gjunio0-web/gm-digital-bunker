// Admin hub shell (spec 05, §2 to §4): sign-in, role check, header, module grid and routing.
// The page served by Netlify is only this shell; every /admin/* address is rewritten to it and the
// route is resolved here. No lead data reaches the static build: everything is read after sign-in.
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, browserLocalPersistence, setPersistence,
  type User,
} from 'firebase/auth';
import { getFirestore, doc, getDoc, type Firestore } from 'firebase/firestore';
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import type { Acao, ChamaAcao } from './leads/acoes';
import { verificarAcesso } from './acesso';
import { voltarConsumido } from './historico';
import { MODULOS, type Modulo } from './registro';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const vistas = { carregando: $('carregando'), entrada: $('entrada'), modulos: $('modulos'), rota: $('rota') };
const sairBtn = $<HTMLButtonElement>('sair');
const form = $<HTMLFormElement>('loginform');
const erroLogin = $<HTMLParagraphElement>('login-erro');
const entrarBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

let desmontar: void | (() => void);

// Single entry of the admin actions (spec 05 §5.7.1; spec 01 §4.1): `acaoAdmin`, region southamerica-east1.
// The answer {ok, estado, analiseAtual} only confirms; the screen follows the Firestore listeners.
let chamaAcao: ChamaAcao = async () => { throw new Error('Firebase not initialised'); };
function criarChamaAcao(funcoes: Functions): ChamaAcao {
  const callable = httpsCallable<{ fichaId: string; acao: Acao; parametros: Record<string, unknown> }, { ok: boolean; estado?: string; analiseAtual?: string | null }>(funcoes, 'acaoAdmin');
  return async (fichaId, acao, parametros = {}) => (await callable({ fichaId, acao, parametros })).data;
}

function mostrar(nome: keyof typeof vistas) {
  for (const [k, el] of Object.entries(vistas)) {
    el.hidden = k !== nome;
    el.classList.toggle('on', k === nome);
  }
}

// ---------- Theme (same key and values as the public site: localStorage "tema" = claro | escuro) ----------
const temaBtn = $<HTMLButtonElement>('themebtn');
function rotuloTema() {
  const claro = document.documentElement.dataset.theme === 'light';
  temaBtn.setAttribute('aria-label', claro ? 'Mudar para tema escuro' : 'Mudar para tema claro');
}
rotuloTema();
temaBtn.addEventListener('click', () => {
  const claro = document.documentElement.dataset.theme === 'light';
  if (claro) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'light';
  try { localStorage.setItem('tema', claro ? 'escuro' : 'claro'); } catch {}
  rotuloTema();
});

// ---------- Firebase ----------
const cfgEl = document.getElementById('firebase-web');
const cfg = cfgEl ? (JSON.parse(cfgEl.textContent || 'null') as FirebaseOptions | null) : null;

if (!cfg) {
  // Production build before the production web app exists (spec 05; guide v1.2, §1)
  mostrar('entrada');
  for (const el of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) el.disabled = true;
  erroLogin.textContent = 'O hub ainda não está configurado neste ambiente.';
  erroLogin.hidden = false;
} else {
  iniciar(cfg);
}

function iniciar(opcoes: FirebaseOptions) {
  const app = initializeApp(opcoes);
  const auth = getAuth(app);
  const db = getFirestore(app);
  chamaAcao = criarChamaAcao(getFunctions(app, 'southamerica-east1'));
  void setPersistence(auth, browserLocalPersistence);

  const ir = (caminho: string) => {
    if (caminho !== location.pathname) history.pushState(null, '', caminho);
    rotear(db);
  };

  // Internal links: any <a data-interno> navigates without reloading
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-interno]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!auth.currentUser) return;
    e.preventDefault();
    ir(a.getAttribute('href') || '/admin');
  });
  addEventListener('popstate', () => { if (voltarConsumido()) return; if (auth.currentUser) rotear(db); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    erroLogin.hidden = true;
    entrarBtn.disabled = true;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const senha = (form.elements.namedItem('senha') as HTMLInputElement).value;
    try {
      await signInWithEmailAndPassword(auth, email, senha);
    } catch (err) {
      const codigo = (err as { code?: string }).code || '';
      erroLogin.textContent =
        codigo === 'auth/invalid-credential' || codigo === 'auth/wrong-password' || codigo === 'auth/user-not-found' || codigo === 'auth/invalid-email'
          ? 'E-mail ou senha incorretos.'
          : codigo === 'auth/too-many-requests'
            ? 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.'
            : codigo === 'auth/network-request-failed'
              ? 'Sem conexão com o serviço de login. Verifique a rede e tente de novo.'
              // Untranslated codes are shown on screen so a failure on a device without dev tools can be diagnosed
              : `Não foi possível entrar. Tente de novo. (código: ${codigo || 'desconhecido'})`;
      erroLogin.hidden = false;
      entrarBtn.disabled = false;
    }
  });

  sairBtn.addEventListener('click', async () => {
    await signOut(auth);
    history.replaceState(null, '', '/admin');
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) return semSessao();
    const acesso = await verificarAcesso(() => lerPapel(db, user));
    if (acesso === 'sem-acesso') {
      await signOut(auth);
      erroLogin.textContent = 'Esta conta não tem acesso à administração.';
      erroLogin.hidden = false;
      return;
    }
    if (acesso === 'indisponivel') {
      // The role could not be read (not the same as having no access): keep the session and ask for a reload,
      // which runs this check again with the stored session. The button stays disabled because signing in
      // again as the same user would not trigger this listener.
      mostrar('entrada');
      entrarBtn.disabled = true;
      erroLogin.textContent = 'Não foi possível verificar o acesso agora. Verifique a conexão e recarregue a página.';
      erroLogin.hidden = false;
      return;
    }
    entrarBtn.disabled = false;
    form.reset();
    erroLogin.hidden = true;
    sairBtn.hidden = false;
    rotear(db);
  });

  function semSessao() {
    if (typeof desmontar === 'function') desmontar();
    desmontar = undefined;
    sairBtn.hidden = true;
    entrarBtn.disabled = false;
    // The requested address is kept: after sign-in, the shell opens it (spec 05, §2)
    mostrar('entrada');
  }
}

// Resolves with the role (null when the document is absent) and rejects when the read fails;
// verificarAcesso (./acesso) tells those two situations apart.
async function lerPapel(db: Firestore, user: User): Promise<string | null> {
  const snap = await getDoc(doc(db, 'usuarios', user.uid));
  return snap.exists() ? ((snap.data().papel as string) ?? null) : null;
}

// ---------- Routing ----------
function rotear(db: Firestore) {
  if (typeof desmontar === 'function') desmontar();
  desmontar = undefined;
  const caminho = location.pathname.replace(/\/+$/, '') || '/admin';
  const modulo = MODULOS.find((m) => m.rota && (caminho === m.rota || caminho.startsWith(m.rota + '/')));
  if (modulo?.render) {
    mostrar('rota');
    desmontar = modulo.render(vistas.rota, caminho, { db, chamaAcao, ir: (c) => { history.pushState(null, '', c); rotear(db); } });
    focarTitulo(vistas.rota);
    return;
  }
  if (caminho !== '/admin') history.replaceState(null, '', '/admin');
  renderModulos(db);
  mostrar('modulos');
}

function focarTitulo(vista: HTMLElement) {
  scrollTo({ top: 0, behavior: 'auto' });
  vista.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function renderModulos(db: Firestore) {
  const grade = $('grade-modulos');
  grade.innerHTML = MODULOS.map((m, i) => cartao(m, i)).join('');
  MODULOS.forEach((m) => {
    if (!m.status) return;
    const alvo = grade.querySelector<HTMLElement>(`[data-status="${m.id}"]`);
    m.status(db).then((t) => { if (alvo) alvo.textContent = t; }).catch(() => { if (alvo) alvo.textContent = 'Ativo'; });
  });
}

function cartao(m: Modulo, i: number) {
  const n = String(i + 1).padStart(2, '0');
  const corpo = `
    <p class="eb">Módulo · ${n}</p>
    <h3>${esc(m.nome)}</h3>
    <p class="tx">${esc(m.descricao)}</p>`;
  if (m.estado === 'ativo' && m.rota) {
    return `<a class="card" href="${m.rota}" data-interno>${corpo}
      <span class="status"><span class="dot on"></span><span data-status="${m.id}">Ativo</span></span>
      <span class="ft">Abrir o módulo →</span></a>`;
  }
  return `<div class="card off">${corpo}
      <span class="status"><span class="dot hollow"></span>Em construção</span>
      <span class="ft">Disponível em breve</span></div>`;
}
