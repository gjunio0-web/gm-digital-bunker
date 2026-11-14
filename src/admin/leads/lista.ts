// Leads list view (spec 05 §5.2–§5.3; mock-up "#leads", published version 32): portfolio map, toolbar,
// sortable list and footnote. montarLista() builds the static frame once; desenhar() redraws map and rows
// from the current fichas, keeping filters, ordering and the map toggle (session only, spec 05 §5.3).
import {
  CONF, ESTADO, GRUPO, QUAD, RETENCAO, cmpQuad, dataLonga, erroTxt, filtrar, guardaTxt, heat, ordenar, pct, prazoTxt,
  verificarAntes, type ChaveOrdem, type FichaVM, type Filtros,
} from './regras';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SEL = (id: string, rotulo: string, opcoes: [string, string][]) =>
  `<div class="field"><label for="${id}" class="vh">${rotulo}</label><select id="${id}">${opcoes
    .map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;

const ORDEM = (k: ChaveOrdem, txt: string, aria?: string) =>
  `<button class="sortb" type="button" data-sort="${k}" aria-pressed="false"${aria ? ` aria-label="${aria}"` : ''}>${txt} <span class="ar">↕</span></button>`;

export function montarLista(alvo: HTMLElement) {
  alvo.innerHTML = `
  <div class="wrap">
    <div class="vhead">
      <a class="crumb" href="/admin" data-interno>← Módulos</a>
      <p class="eyebrow">Módulo · 01</p>
      <h2 id="t-leads" tabindex="-1">Leads</h2>
      <p class="lead">Fichas por quadrante, grau, confiança e prazo de resposta, com o estado do pipeline em cada linha.</p>
    </div>
    <div class="panel mapa">
      <details open>
        <summary>
          <h3>Mapa da carteira</h3>
          <span class="tgl"><span class="t-open">Ocultar mapa</span><span class="t-closed">Mostrar mapa</span></span>
        </summary>
        <p class="sub">Aderência × Intenção, em pontos · limiar de 15 em cada eixo · círculo vazado: cálculo da triagem · cobalto: primeiro da fila</p>
        <div class="matwrap" id="mapWrap"></div>
        <div class="mtrig"><button class="btn text" type="button" id="openMetodo" aria-haspopup="dialog">Como o mapa é calculado →</button></div>
      </details>
    </div>
    <div class="toolbar" role="search">
      <div class="field"><label for="q" class="vh">Buscar por nome ou empresa</label><input id="q" type="search" placeholder="Buscar nome ou empresa"></div>
      ${SEL('f-estado', 'Filtrar por estado', [['', 'Todos os estados'], ['entrada', 'Entrada (recebida, qualificada)'], ['sem', 'Sem análise (descartada, resposta breve)'], ['analise', 'Em análise (coletando, coletada, sintetizando)'], ['revisar', 'Para revisar (pronta, com pendências)'], ['andamento', 'Em andamento (aprovada, respondida)'], ['arquivada', 'Arquivada'], ['erro', 'Com erro']])}
      ${SEL('f-grau', 'Filtrar por grau', [['', 'Todos os graus'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']])}
      ${SEL('f-conf', 'Filtrar por confiança', [['', 'Confiança: todas'], ['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']])}
      ${SEL('f-quad', 'Filtrar por quadrante', [['', 'Todos os quadrantes'], ['priorizar', 'Priorizar'], ['nutrir', 'Nutrir'], ['qualificar', 'Qualificar'], ['declinar', 'Declinar']])}
      ${SEL('f-ader', 'Filtrar por aderência', [['', 'Aderência: todas'], ['alta', 'Aderência: 15 ou mais'], ['baixa', 'Aderência: abaixo de 15']])}
      ${SEL('f-esc', 'Filtrar por escopo', [['', 'Escopo: todos'], ['aprovado', 'Aprovado'], ['ressalva', 'Ressalva'], ['barrado', 'Barrado']])}
      ${SEL('f-porta', 'Filtrar por porta provável', [['', 'Porta: todas'], ['projeto', 'Projeto'], ['conselho', 'Conselho'], ['workshop', 'Workshop'], ['combinacao', 'Combinação']])}
    </div>
    <div class="ltable">
      <div class="lhead" role="group" aria-label="Ordenar a lista">
        <div class="lh-who">${ORDEM('data', 'Recebida')}</div>
        <div class="lh-perfil">${ORDEM('ea', 'A', 'Ordenar por Aderência')}${ORDEM('ed', 'D', 'Ordenar por Decisão')}${ORDEM('ei', 'I', 'Ordenar por Intenção e momento')}${ORDEM('ec', 'C', 'Ordenar por Clareza da oportunidade')}</div>
        <div class="lh-calor">${ORDEM('grau', 'Grau')}</div>
        <div class="lh-tags">${ORDEM('quad', 'Quadrante')}${ORDEM('estado', 'Estado')}</div>
      </div>
      <ul class="leads" id="leadsList"><li><p class="empty" style="padding:var(--space-6) var(--space-2)">Carregando fichas…</p></li></ul>
    </div>
    <p class="list-note" id="listNote"></p>
  </div>`;
}

function perfilHTML(f: FichaVM): string {
  if (!f.lead) return '<span class="perfil" role="img" aria-label="Sem eixos"></span>';
  const e = f.lead.eixos;
  const lab = { a: 'Aderência', d: 'Decisão', i: 'Intenção', c: 'Clareza' } as const;
  const ks = ['a', 'd', 'i', 'c'] as const;
  const aria = ks.map((k) => (e[k] ? `${lab[k]} ${e[k]![0]} de ${e[k]![1]}` : `${lab[k]} não avaliado`)).join(', ');
  return `<span class="perfil" role="img" aria-label="${aria}">` +
    ks.map((k) => `<em>${k.toUpperCase()}</em>` + (e[k] ? `<span class="t"><i style="width:${pct(e[k]!)}%"></i></span>` : '<span class="t na"></span>')).join('') +
    '</span>';
}

function linhaHTML(f: FichaVM, hoje: Date): string {
  let tags = '';
  if (f.lead) tags += `<span class="chip"><span class="q">${QUAD[f.lead.quadrante]}</span></span>`;
  const vazado = GRUPO[f.estado] === 'sem' || f.estado === 'arquivada';
  tags += `<span class="chip"><span class="dot${vazado ? ' hollow' : ' on'}"></span>${esc(ESTADO[f.estado] ?? f.estado)}</span>`;
  if (f.retencao) tags += `<span class="chip">${esc(RETENCAO[f.retencao.motivo] ?? 'Retida')}</span>`;
  if (verificarAntes(f)) tags += '<span class="chip warn">Verificar antes de agir</span>';
  if (f.erro) tags += `<span class="chip err">${esc(erroTxt(f.erro))}</span>`;
  const sc = f.lead ? `<b>${f.lead.pontos}</b>` : '<b>–</b>';
  const sub = f.lead ? `Grau ${f.lead.grau}${f.lead.momento === 'triagem' ? ' · triagem' : ''}` : 'Em análise';
  const conf = f.lead?.confianca ? ` · conf. ${CONF[f.lead.confianca]}` : '';
  const guarda = guardaTxt(f);
  const meta = [esc(f.cargo), dataLonga(f.recebidaEm), esc(prazoTxt(f, hoje)) + conf, guarda ? esc(guarda) : ''].filter(Boolean).join(' · ');
  return `<li><a class="row" href="/admin/leads/${encodeURIComponent(f.id)}" data-interno>` +
    `<span class="cwho"><span class="who">${esc(f.nome)} <span class="co">· ${esc(f.empresa)}</span></span>` +
    `<span class="meta">${meta}</span></span>` +
    perfilHTML(f) +
    `<span class="calor grade"><i class="mk ${heat(f)}" aria-hidden="true"></i><span class="sc">${sc}<span>${sub}</span></span></span>` +
    `<span class="tags">${tags}</span></a></li>`;
}

/** Portfolio map: Aderência × Intenção, cut at 15; hollow = triagem; one cobalt point, never a spam ficha. */
function mapaHTML(todas: FichaVM[]): string {
  const pts = todas.filter((f) => f.lead && f.lead.eixos.a && f.lead.eixos.i);
  const melhor = pts.filter((f) => !f.lead!.spam).sort(cmpQuad)[0];
  const rotulo = pts.map((f) => `${f.nome} em ${QUAD[f.lead!.quadrante]}`).join('; ');
  let svg = `<svg class="mat" viewBox="0 0 440 420" role="img" aria-label="Mapa de quadrantes${rotulo ? ': ' + esc(rotulo) : ''}">` +
    '<line x1="60" y1="20" x2="60" y2="360" stroke="var(--line-strong)" stroke-width="1.5"/><line x1="60" y1="360" x2="400" y2="360" stroke="var(--line-strong)" stroke-width="1.5"/>' +
    '<line x1="230" y1="20" x2="230" y2="360" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="4 4"/><line x1="60" y1="190" x2="400" y2="190" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="4 4"/>' +
    '<text x="236" y="38" font-size="11" letter-spacing=".08em">PRIORIZAR</text><text x="68" y="38" font-size="11" letter-spacing=".08em">QUALIFICAR</text>' +
    '<text x="236" y="352" font-size="11" letter-spacing=".08em">NUTRIR</text><text x="68" y="352" font-size="11" letter-spacing=".08em">DECLINAR</text>' +
    '<text x="230" y="392" font-size="12" text-anchor="middle">ADERÊNCIA →</text><text x="26" y="190" font-size="12" text-anchor="middle" transform="rotate(-90 26 190)">INTENÇÃO →</text>';
  const usados = new Set<string>();
  const rots: [number, number, number][] = [];
  const colide = (px: number, py: number, an: string) => {
    const x0 = an === 'end' ? px - 80 : px, x1 = an === 'end' ? px : px + 80;
    return rots.some((l) => Math.max(x0, l[0]) < Math.min(x1, l[1]) && Math.abs(l[2] - py) < 14);
  };
  for (const f of pts) {
    const l = f.lead!;
    let x = 60 + pct(l.eixos.a!) * 3.4;
    const y = 360 - pct(l.eixos.i!) * 3.4;
    const k = `${Math.round(x)}-${Math.round(y)}`;
    if (usados.has(k)) x += 12;
    usados.add(k);
    const eu = f === melhor;
    let anchor = x > 300 ? 'end' : 'start', tx = x > 300 ? x - 12 : x + 12, ty = y + 4;
    if (colide(tx, ty, anchor)) {
      const an2 = anchor === 'end' ? 'start' : 'end', tx2 = an2 === 'end' ? x - 12 : x + 12;
      if (!colide(tx2, ty, an2)) { anchor = an2; tx = tx2; } else { ty += 14; }
    }
    rots.push([anchor === 'end' ? tx - 80 : tx, anchor === 'end' ? tx : tx + 80, ty]);
    const tri = l.momento === 'triagem';
    svg += `<circle cx="${x}" cy="${y}" r="${eu ? 6 : 5}" fill="${eu ? 'var(--accent)' : tri ? 'var(--surface)' : 'var(--ink-body)'}"` +
      (tri && !eu ? ' stroke="var(--ink-body)" stroke-width="1.5"' : '') + '/>' +
      `<text x="${tx}" y="${ty}" font-size="12" text-anchor="${anchor}"${eu ? ' fill="var(--ink)"' : ''}>${esc(f.nome.split(' ')[0])} · ${l.grau}</text>`;
  }
  return svg + '</svg>';
}

export interface EstadoLista { chave: ChaveOrdem; dir: 'asc' | 'desc' }

export function lerFiltros(alvo: HTMLElement): Filtros {
  const v = (id: string) => (alvo.querySelector<HTMLInputElement | HTMLSelectElement>('#' + id)?.value ?? '');
  return { q: v('q'), estado: v('f-estado'), grau: v('f-grau'), conf: v('f-conf'), quad: v('f-quad'), ader: v('f-ader'), esc: v('f-esc'), porta: v('f-porta') };
}

export function desenhar(alvo: HTMLElement, todas: FichaVM[], est: EstadoLista, hoje: Date) {
  const mapa = alvo.querySelector('#mapWrap');
  if (mapa) mapa.innerHTML = mapaHTML(todas);
  const lista = ordenar(filtrar(todas, lerFiltros(alvo)), est.chave, est.dir);
  alvo.querySelector('#leadsList')!.innerHTML = lista.length
    ? lista.map((f) => linhaHTML(f, hoje)).join('')
    : `<li><p class="empty" style="padding:var(--space-6) var(--space-2)">${todas.length ? 'Nenhuma ficha com esses filtros.' : 'Nenhuma ficha recebida.'}</p></li>`;
  alvo.querySelector('#listNote')!.textContent =
    `${lista.length} de ${todas.length} fichas · ordem padrão: quadrante, grau, confiança e prazo de resposta · d.ú. = dias úteis restantes · estimativa – pesos de partida`;
  alvo.querySelectorAll<HTMLButtonElement>('.sortb').forEach((b) => {
    const on = b.dataset.sort === est.chave;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.querySelector('.ar')!.textContent = on ? (est.dir === 'asc' ? '↑' : '↓') : '↕';
  });
}

/** Binds filters and sort controls; `redesenhar` is called after every change. */
export function ligarControles(alvo: HTMLElement, est: EstadoLista, redesenhar: () => void) {
  alvo.querySelector('.toolbar')!.addEventListener('input', redesenhar);
  alvo.querySelector('.toolbar')!.addEventListener('change', redesenhar);
  alvo.querySelectorAll<HTMLButtonElement>('.sortb').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.sort as ChaveOrdem;
      if (est.chave === k) est.dir = est.dir === 'asc' ? 'desc' : 'asc';
      else { est.chave = k; est.dir = 'desc'; } // every criterion starts descending (guide v1.2 §7)
      redesenhar();
    }));
}
