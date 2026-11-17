// Ficha detail (spec 05 §5.4–§5.5; guide v1.3 §5.2 and §5.2.1; mock-up renderFicha). Read-only: the action
// bar and the editor arrive with acaoAdmin (phase 5). Pure functions only – documents in, HTML out – so the
// detail renders from Firestore in the hub and from fixtures in the local acceptance test. Firestore
// timestamps are converted to Date by the data layer (dadosFicha.ts) before they reach this file.
import { CARGO, CONF, ESTADO, QUAD, dataCurta, dataLonga, erroTxt, restanteTxt } from './regras';
import {
  CK_RES, DEDUCAO, DESTINO, ETAPA_COLETA, ETAPA_TEXTO, MAX_PORTE, MAX_TECNOLOGIA, PEND_TIPO, PORTA, PRAZO_DIAS,
  RETENCAO_CURTO, RETENCAO_MOTIVO, SO_NA_ANALISE, TECNOLOGIA, avisoTxt, linhaParcelas, modeloTxt, nomeRegra,
  parcelaTxt, porteTxt, respostaTxt, secaoDoLocal, secaoTxt,
} from './rotulos';

type Obj = Record<string, any>;
export interface Analise { id: string; num: number; d: Obj }
export interface Evento { em: Date | null; tipo: string; detalhe: Obj }
export interface DadosFicha {
  id: string;
  f: Obj;                      // fichas/{id}
  analises: Analise[];         // analise/*, newest first
  eventos: Evento[];           // eventos/*, oldest first
  coleta: Record<string, Obj>; // coleta/{etapa}
}

/** What the dossier needs: the ficha and its analysis versions. */
export type DadosDossie = Pick<DadosFicha, 'id' | 'f' | 'analises'>;

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const isDate = (x: unknown): x is Date => x instanceof Date && !isNaN(x.getTime());
/** "21:14", São Paulo time. */
export function horaSP(d: Date): string {
  const l = new Date(d.getTime() - 3 * 3600_000);
  return `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`;
}
const quando = (d: unknown) => (isDate(d) ? `${dataCurta(d)} ${horaSP(d)}` : '–');
const quandoLongo = (d: unknown) => (isDate(d) ? `${dataLonga(d)} ${horaSP(d)}` : '–');
/** "5/nov/2026 às 10:21", for dates inside sentences (mock-up). */
const quandoFrase = (d: unknown) => (isDate(d) ? `${dataLonga(d)} às ${horaSP(d)}` : '–');
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Opening ----------
export function abertura(d: DadosFicha | null): { eyebrow: string; titulo: string; lead: string } {
  if (!d) return { eyebrow: 'Ficha', titulo: 'Ficha não encontrada', lead: 'Esta ficha não existe ou já foi excluída pelo prazo de guarda.' };
  const f = d.f, o = f.original ?? {}, l = f.lead;
  const partes = ['Ficha'];
  if (l?.quadrante) {
    partes.push(QUAD[l.quadrante as keyof typeof QUAD] ?? l.quadrante, `Grau ${l.grau}${l.momento === 'triagem' ? ' · triagem' : ''}`, `${l.pontos} pontos`);
    if (l.modificadores?.confianca) partes.push(`confiança ${CONF[l.modificadores.confianca as keyof typeof CONF] ?? l.modificadores.confianca}`);
  } else partes.push('Em análise');
  partes.push(ESTADO[f.estado] ?? String(f.estado ?? ''));
  const cargo = CARGO[o.cargo] ?? String(o.cargo ?? '');
  return {
    eyebrow: partes.join(' · '),
    titulo: String(o.nome ?? ''),
    lead: [o.empresa, cargo].filter(Boolean).map(String).join(' · ') + (isDate(f.recebidaEm) ? ` · recebida em ${dataLonga(f.recebidaEm)}` : ''),
  };
}

// ---------- Version selector (spec 05 §5.4 and §5.9) ----------
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const CHECK = '<svg class="pk-ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
export function seletorHTML(id: string, rotulo: string, opcoes: [string, string, string][], sel: string): string {
  const cur = opcoes.find((o) => o[0] === sel) ?? opcoes[0];
  return `<div class="pk"><button class="pick" type="button" id="${id}" aria-expanded="false" aria-controls="${id}-l" data-value="${esc(cur[0])}">` +
    `<span class="pk-lb">${esc(rotulo)}</span><span class="pk-val">${esc(cur[1])}</span>${CHEV}</button>` +
    `<div class="pk-drop" id="${id}-l" hidden><ul class="pk-opts" role="radiogroup" aria-label="${esc(rotulo)}">` +
    opcoes.map((o) => `<li><button class="pk-opt" type="button" role="radio" aria-checked="${o[0] === cur[0]}" data-v="${esc(o[0])}"><span class="pk-n">${esc(o[1])}</span>${o[2] ? `<span class="pk-d">${esc(o[2])}</span>` : ''}${CHECK}</button></li>`).join('') +
    '</ul></div></div>';
}
export function versaoDesc(a: Analise): string {
  const au = a.d.autor ?? {};
  const quem = au.tipo === 'humano' ? 'humano' : `IA (${modeloTxt(au.id) || 'modelo não registrado'})`;
  const origem = au.origem === 'correcao' && a.d.baseadaEm ? ` · corrigida a partir de ${a.d.baseadaEm}` : '';
  return `${quem}${origem} · ${quandoLongo(a.d.criadaEm)}`;
}

// ---------- Findings of the verification ----------
export const ehAviso = (p: Obj) => p.tipo === 'mecanica' && p.regra === 'numero_sem_fonte';
const ordemPend = (p: Obj) => (ehAviso(p) ? 3 : p.tipo === 'escopo' ? 0 : p.tipo === 'estrutura' ? 1 : 2);
function pendenciasHTML(a: Analise): string {
  const ps: Obj[] = (a.d.verificacao?.pendencias ?? []).slice().sort((x: Obj, y: Obj) => ordemPend(x) - ordemPend(y));
  if (!ps.length) return '';
  return '<div class="panel"><h3>Pendências da verificação</h3><ul class="pend">' + ps.map((p) => {
    const trecho = p.trecho ?? p.texto ?? '';
    if (ehAviso(p)) return `<li class="aviso"><p class="pt">Aviso – número sem fonte na mesma frase · ${esc(secaoTxt(p.secao))}</p><p class="tr">"${esc(trecho)}"</p></li>`;
    const regra = nomeRegra(p.regra, p.regraNome);
    const trat = p.tratamento === 'corrigida' ? `Corrigida na ${esc(a.id)}`
      : p.tratamento === 'sem_alteracao' ? `Sem alteração – ${esc(p.razao ?? '')}`
      : p.tratamento === 'mantida' ? `Mantida – ${esc(p.razao ?? '')}` : '';
    return `<li${p.tipo === 'escopo' ? ' class="esc"' : ''}><p class="pt">Pendência de ${esc(PEND_TIPO[p.tipo] ?? p.tipo)} · ${esc(secaoTxt(p.secao))}</p>` +
      (regra ? `<p class="cs" style="margin:0 0 4px">Regra: ${esc(regra)}</p>` : '') +
      `<p class="tr">"${esc(trecho)}"</p>` +
      (p.correcaoSugerida ? `<p class="cs">Correção sugerida: ${esc(p.correcaoSugerida)}</p>` : '') +
      (trat ? `<p class="cs" style="margin-top:var(--space-2);color:var(--ink);font-weight:600">${trat}</p>` : '') + '</li>';
  }).join('') + '</ul></div>';
}

// ---------- Pipeline error (spec 05 §5.4) ----------
const INTERROMPIDA: Record<string, [string, string, string]> = {
  'interrupcao:coletando': ['Coleta interrompida.', 'Coletando', 'Use "Reexecutar" para retomar as etapas que não terminaram.'],
  'interrupcao:coleta_minima': ['Coleta mínima interrompida.', 'Coleta mínima', 'Use "Reexecutar" para retomar as etapas da coleta mínima que não terminaram.'],
  'interrupcao:sintetizando': ['Síntese interrompida.', 'Sintetizando', 'Use "Reexecutar › Síntese" para gerar a análise de novo.'],
};
function erroHTML(d: DadosFicha): string {
  const e = d.f.erro;
  if (!e || !e.etapa) return '';
  const it = INTERROMPIDA[e.etapa];
  if (it) {
    const parada = d.eventos.filter((x) => x.tipo === 'parada').pop();
    const min = parada?.detalhe?.minutos ?? '?';
    return `<div class="panel"><h3>Erro no pipeline</h3><ul class="pend"><li class="esc"><p class="pt">${esc(erroTxt(e))}</p>` +
      `<p class="tr"><strong>${it[0]}</strong> A ficha ficou em ${it[1]} por mais de ${esc(min)} minutos sem concluir, e o pipeline a marcou como parada em ${esc(quandoFrase(parada?.em))}. ${esc(it[2])}</p></li></ul></div>`;
  }
  return `<div class="panel"><h3>Erro no pipeline</h3><ul class="pend"><li class="esc"><p class="pt">${esc(erroTxt(e))}</p>` +
    (e.mensagem ? `<p class="tr">${esc(e.mensagem)}</p>` : '') +
    '<p class="cs">Use "Reexecutar" para repetir a etapa; a análise segue a partir dela.</p></li></ul></div>';
}

// ---------- Received ficha ----------
const fmtCnpj = (c: string) => {
  const n = String(c).replace(/\D/g, '');
  return n.length === 14 ? `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}` : String(c);
};
const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
export function cnpjTxt(reg: Obj | undefined): string {
  const c = reg?.conteudo;
  const cnpj = c?.escolhido?.cnpj;
  if (!c || !cnpj || c.confirmado === false) return 'a confirmar na primeira conversa';
  const origem = c.origemCnpj === 'site' ? 'encontrado no site' : c.origemCnpj === 'busca' ? 'encontrado na busca' : null;
  const NOMES: Record<string, string> = { razaoSocial: 'razão social', municipio: 'município', cnae: 'CNAE' };
  const cv: Obj = c.criteriosValidacao ?? {};
  const por = (v: string) => Object.keys(NOMES).filter((k) => cv[k] === v).map((k) => NOMES[k]);
  const ok = por('atendido'), contra = por('contradito'), sem = por('sem_dado');
  const crit = [
    ok.length ? `${juntar(ok)} conferido${ok.length > 1 ? 's' : ''}` : '',
    contra.length ? `${juntar(contra)} contradito${contra.length > 1 ? 's' : ''}` : '',
    sem.length ? `sem dado de ${juntar(sem)}` : '',
  ].filter(Boolean).join('; ');
  return [fmtCnpj(cnpj), origem, crit].filter(Boolean).join(' · ');
}
export function guardaDetalheTxt(f: Obj): string {
  if (!isDate(f.expurgoEm)) return '–';
  const base = f.estado === 'respondida' && isDate(f.respondidaEm) ? f.respondidaEm : f.recebidaEm;
  const dias = isDate(base) ? Math.round((f.expurgoEm.getTime() - base.getTime()) / 86_400_000) : null;
  const l = f.lead;
  const motivo = !l ? '' : l.modificadores?.spam ? ', spam' : l.momento === 'triagem' && l.quadrante === 'declinar' ? ', Declinar na triagem' : l.momento === 'analise' && l.grau === 'D' ? ', grau D' : '';
  const resp = f.estado === 'respondida' && isDate(f.respondidaEm) ? `, contados da resposta em ${dataCurta(f.respondidaEm)}` : '';
  return `até ${dataLonga(f.expurgoEm)}` + (dias !== null && dias < 90 ? ` (${dias} dias${motivo})` : dias !== null ? ` (${dias} dias${resp})` : '');
}
function fichaRecebidaHTML(d: DadosFicha): string {
  const f = d.f, o = f.original ?? {};
  const porta = f.portaDecidida ? `<dt>Porta</dt><dd>${esc(PORTA[f.portaDecidida] ?? f.portaDecidida)} (decidida)</dd>` : '';
  const msg = o.mensagem ? `<p class="msg">"${esc(o.mensagem)}"</p>` : '<p class="msg">Sem mensagem.</p>';
  return '<div class="panel"><h3>Ficha recebida</h3><dl class="kv">' +
    `<dt>E-mail</dt><dd>${esc(o.email ?? '–')}</dd><dt>Site</dt><dd>${esc(o.site || 'não informado')}</dd>` +
    `<dt>CNPJ</dt><dd>${esc(cnpjTxt(d.coleta.empresa_registro))}</dd><dt>Origem</dt><dd>${esc(f.origem?.pagina || '–')}</dd>` +
    `<dt>Guarda</dt><dd>${esc(guardaDetalheTxt(f))}</dd>${porta}</dl>${msg}</div>`;
}

// ---------- People (spec 03, section 5) ----------
const FONTE: Record<string, string> = { formulario: 'Formulário', hunter: 'Hunter', busca: 'Busca pública' };
function pessoasHTML(d: DadosFicha): string {
  const s = d.coleta.empresa_pessoas?.status === 'concluida' ? d.coleta.empresa_pessoas?.conteudo?.signatario : null;
  const linhas: [string, string, string][] = s?.cargoFontes?.length
    ? s.cargoFontes.map((x: Obj) => [FONTE[x.fonte] ?? String(x.fonte ?? ''), x.cargo ?? 'não encontrado', [x.senioridade, x.empresaAtual].filter(Boolean).join(' · ') || '–'])
    : [['Formulário', CARGO[d.f.original?.cargo] ?? String(d.f.original?.cargo ?? '–'), '–']];
  const nota = !s ? 'A etapa Pessoas ainda não rodou: só o cargo do formulário. Trajetória profissional não coletada.'
    : (s.divergenciaCargo ? `Divergência entre as fontes: ${s.divergenciaCargo}.` : 'Sem divergência entre as fontes.') + ' Trajetória profissional não coletada.';
  return '<div class="panel"><h3>Pessoas</h3><table class="ptable"><thead><tr><th>Fonte</th><th>Cargo</th><th>Senioridade · empresa</th></tr></thead><tbody>' +
    linhas.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('') +
    `</tbody></table><p class="help">${esc(nota.replace(/\.\./g, '.'))}</p></div>`;
}

// ---------- Preliminary assessment (spec 05 §5.5) ----------
export function rascunhoTexto(r: Obj | undefined): string {
  if (!r) return '';
  if (typeof r === 'string') return r;
  return (r.assunto ? `Assunto: ${r.assunto}\n\n` : '') + String(r.corpo ?? '');
}
function avaliacaoHTML(d: DadosFicha, a: Analise | null): string {
  const f = d.f;
  let h = '<div class="panel"><h3>Avaliação preliminar</h3>';
  if (a) {
    h += `<div class="actions"><a class="btn secondary" href="/admin/leads/${encodeURIComponent(d.id)}/dossie" data-interno>Abrir dossiê completo</a>` +
      // "Salvar PDF" opens the dossier, which prints once drawn (spec 05 v1.18)
      `<a class="btn secondary" href="/admin/leads/${encodeURIComponent(d.id)}/dossie?imprimir=1" data-interno>Salvar PDF</a></div>` +
      '<div class="facc">' +
      `<details data-k="resumo"><summary><span>Resumo executivo<small>análise ${esc(a.id)} · até 80 palavras</small></span><span class="pl" aria-hidden="true"></span></summary><div class="body"><div><p>${esc(a.d.resumoExecutivo ?? 'Sem resumo nesta versão.')}</p></div></div></details>` +
      `<details data-k="rascunho"><summary><span>Rascunho de resposta<small>análise ${esc(a.id)} · até 120 palavras</small></span><span class="pl" aria-hidden="true"></span></summary><div class="body"><div><p class="draft">${esc(rascunhoTexto(a.d.rascunhoResposta) || 'Sem rascunho nesta versão.')}</p>` +
      '<div class="copyrow"><button class="btn text" type="button" data-act="copiar">Copiar rascunho →</button></div></div></div></details></div>';
  } else if (f.retencao?.motivo) {
    const r = f.retencao;
    h += `<p class="empty">A triagem mandaria esta ficha à análise, mas ela está retida em Qualificada desde ${esc(quandoFrase(r.desde))}: ${esc(RETENCAO_MOTIVO[r.motivo] ?? r.motivo)}.` +
      (isDate(r.liberacaoPrevista) ? ` Segue sozinha para a análise em ${esc(quandoFrase(r.liberacaoPrevista))}.` : '') + '</p>';
  } else {
    h += `<p class="empty">${f.lead?.modificadores?.spam || f.estado === 'descartada' ? 'Sem análise completa: ficha descartada como spam.'
      : f.estado === 'resposta_breve' ? 'Sem análise completa: o quadrante da triagem foi Declinar.' : 'A análise ainda não terminou.'}</p>`;
  }
  return h + '</div>';
}

// ---------- Qualification (spec 05 §5.4; spec 04, section 7) ----------
export function combinacaoTxt(a: Analise | null): string | null {
  const e = a?.d.enquadramento;
  if (!e || e.portaProvavel !== 'combinacao') return null;
  return e.portaCombinacao || e.detalhe?.porta?.combinacao || 'Combinação (não detalhada)';
}
export function qualificacaoHTML(f: Obj, atual: Analise | null, hoje: Date): string {
  const l = f.lead;
  if (!l?.quadrante) return '<div class="panel"><h3>Qualificação</h3><p class="empty">Triagem em andamento.</p></div>';
  const tri = l.momento === 'triagem';
  const md = l.modificadores ?? {};
  const e = l.eixos ?? {};
  const eix = (k: string): [number, number, Obj[]] => [Number(e[k]?.pontos ?? 0), Number(e[k]?.maximo ?? 0), e[k]?.parcelas ?? []];
  const pct = (n: number, m: number) => (m > 0 ? Math.round((n / m) * 100) : 0);
  const triMax = (ps: Obj[], m: number) => m - ps.filter((p) => p.marca).reduce((t, p) => t + (SO_NA_ANALISE[p.criterio] ?? 0), 0);
  const ad = e.aderencia ?? {};
  const rows = ([['aderencia', 'Aderência'], ['decisao', 'Decisão'], ['intencao', 'Intenção e momento'], ['clareza', 'Clareza da oportunidade']] as const).map(([k, nome]) => {
    const [n, m, ps] = eix(k);
    const tmax = tri && k !== 'aderencia' ? triMax(ps, m) : null;
    return `<span class="lb">${nome}<small>até ${m}${tmax !== null && tmax !== m ? ` · ${tmax} na triagem` : ''}</small></span><span class="t"><i style="width:${pct(n, m)}%"></i></span><span class="v">${n}</span>`;
  }).join('');
  const comb = tri ? null : combinacaoTxt(atual);
  const linha = (k: string) => linhaParcelas(eix(k)[2].map((p) => [parcelaTxt(p as any, comb), Number(p.pontos ?? 0)]));
  const porte = ad.porte ?? {}, tec = ad.tecnologia ?? {};
  const why = [
    ['Aderência', linhaParcelas([[porteTxt(porte.categoria, porte.fonteFuncionarios), Number(porte.pontos ?? 0)], [TECNOLOGIA[tec.categoria] ?? String(tec.categoria ?? ''), Number(tec.pontos ?? 0)]])],
    ['Decisão', linha('decisao')], ['Intenção', linha('intencao')], ['Clareza', linha('clareza')],
  ].map(([t, v]) => `<li><strong>${t}:</strong> ${esc(v)}</li>`).join('') +
    (l.deducoes ?? []).map((x: Obj) => `<li><strong>Dedução ${String(x.pontos).replace('-', '−')}:</strong> ${esc(DEDUCAO[x.risco] ?? x.risco)}</li>`).join('');
  const filtro = md.escopo === 'ressalva' ? '<p class="qwhy">Escopo com ressalva: o grau fica limitado a B, embora os pontos levem a A.</p>'
    : md.escopo === 'barrado' ? '<p class="qwhy">Escopo barrado: o grau é D, independentemente dos pontos.</p>' : '';
  const mods: string[] = [];
  if (md.spam) mods.push('spam');
  if (md.escopo === 'barrado') mods.push('escopo barrado');
  if (md.escopo === 'ressalva') mods.push('escopo com ressalva');
  if (md.confianca === 'baixa') mods.push('confiança baixa');
  const verificar = md.confianca === 'baixa' && (l.grau === 'A' || l.grau === 'B');
  const dest = DESTINO[l.destino]?.[0] ?? String(l.destino ?? '');
  const prazoEm: Date | null = isDate(l.acao?.prazoEm) ? l.acao.prazoEm : null;
  const nDias = Number(l.acao?.prazoDiasUteis ?? 0);
  const prazo = md.spam ? 'não se aplica'
    : `${PRAZO_DIAS(nDias)}` + (f.estado === 'respondida' ? ' · respondida' : prazoEm ? ` · até ${dataCurta(prazoEm)} (${restanteTxt(hoje, prazoEm)})` : ' · prazo após a análise');
  const aq = `<div class="aq"><p class="aqt">Aderência · perguntas sobre a empresa</p><table><tbody>` +
    `<tr><th scope="row">Porte na faixa atendida<small>${esc(porteTxt(porte.categoria, porte.fonteFuncionarios))}</small></th><td>${Number(porte.pontos ?? 0)} de ${MAX_PORTE}</td></tr>` +
    `<tr><th scope="row">Estrutura de tecnologia<small>${esc(TECNOLOGIA[tec.categoria] ?? String(tec.categoria ?? ''))}${tec.evidencia ? ' – ' + esc(tec.evidencia) : ''}</small></th><td>${Number(tec.pontos ?? 0)} de ${MAX_TECNOLOGIA}</td></tr>` +
    `<tr class="tot"><th scope="row">Aderência</th><td>${Number(ad.pontos ?? 0)} de ${Number(ad.maximo ?? 30)}</td></tr></tbody></table></div>`;
  return '<div class="panel"><h3>Qualificação</h3>' +
    `<div class="qquad"><span class="qn">${QUAD[l.quadrante as keyof typeof QUAD] ?? esc(l.quadrante)}</span><span class="qd">Destino: ${esc(dest)}</span><span class="qm">${mods.length ? 'modificadores: ' + mods.join(' · ') : 'sem modificadores'} · cálculo da ${tri ? 'triagem' : 'análise'}</span></div>` +
    (verificar ? `<p class="qwarn">Verificar antes de agir: ${esc(md.confiancaMotivo ?? '')}. A ação recomendada vale depois de confirmar o CNPJ ou o número de funcionários, ou de reexecutar a etapa em falta.</p>` : '') +
    `<div class="qhead"><span class="g">${esc(l.grau)}</span><span class="p">${l.pontos} pontos</span><span class="c">confiança ${CONF[md.confianca as keyof typeof CONF] ?? '–'}${md.confiancaMotivo ? ' · ' + esc(md.confiancaMotivo) : ''}</span></div>` +
    `<div class="hbars">${rows}</div>${filtro}${aq}` +
    `<ul class="qwhy" style="padding-left:1.1em;margin-top:var(--space-4)">${why}</ul>` +
    (tri ? '<p class="qwhy">Cálculo da triagem: as parcelas que dependem da coleta completa (confirmação do cargo, notícias, hipóteses e direção do potencial) valem 0.</p>' : '') +
    `<div class="qact"><dl><dt>Prazo</dt><dd>${esc(prazo)}</dd><dt>Resposta</dt><dd>${esc(respostaTxt(l.destino, !!md.spam, md.escopo ?? null))}</dd></dl>` +
    '<p class="est" style="margin-top:var(--space-3)">Estimativa – pesos de partida</p></div></div>';
}

// ---------- Pipeline events (spec 05 §5.4; guide v1.3 §5.2.1) ----------
const STATUS: Record<string, string> = { concluida: 'concluída', falhou: 'falhou', executando: 'em execução', pendente: 'pendente' };
const statusTxt = (s: unknown) => STATUS[String(s)] ?? String(s ?? '');
const ASSUNTO: Record<string, string> = { problema: 'mensagem com problema', ambos: 'com problema e ferramenta', ferramenta: 'só com ferramenta', nenhum: 'sem problema nem ferramenta' };
const DESTINO_TRIAGEM: Record<string, string> = { coletando: 'análise completa', resposta_breve: 'resposta breve', descartada: 'descartada', qualificada: 'aguardando liberação' };
const ALVO_REEXECUCAO: Record<string, string> = { sintese: 'Síntese', qualificacao: 'Qualificação' };
const ACOES: Record<string, (x: Obj) => string> = {
  aprovada: () => 'Aprovada',
  // acaoAdmin writes editada {secao, baseadaEm, versao}, reexecucao {alvos} and porta_decidida {de, para}. Older events may
  // lack the fields: each label then falls back to plain text without a gap, and never throws.
  editada: (x) => {
    const secao = typeof x.secao === 'string' && x.secao ? secaoTxt(x.secao) : '';
    const versao = typeof x.versao === 'string' ? x.versao : '';
    return ['Editada', secao && versao ? `${secao} → ${versao}` : secao || versao].filter(Boolean).join(' · ');
  },
  reexecucao: (x) => {
    const alvos = (Array.isArray(x.alvos) ? x.alvos : []).filter((a: unknown) => typeof a === 'string' && a).map((a: string) => ALVO_REEXECUCAO[a] ?? ETAPA_COLETA[a] ?? a);
    return alvos.length ? `Reexecução · ${alvos.join(', ')}` : 'Reexecução';
  },
  porta_decidida: (x) => {
    const nome = (p: unknown) => (typeof p === 'string' && p ? PORTA[p] ?? p : '');
    const de = nome(x.de), para = nome(x.para);
    return ['Porta decidida', de && para ? `${de} → ${para}` : para].filter(Boolean).join(' · ');
  },
  resposta_enviada: () => 'Resposta enviada',
  arquivada: () => 'Arquivada',
  destino_alterado: () => 'Destino alterado · análise completa',
};
const diaTxt = (dia: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia ?? '')); return m ? dataCurta(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 15))) : String(dia ?? ''); };

/** Label of one event, or null when the event is not shown (the first coleta_iniciada). */
export function eventoTxt(ev: Evento, d: DadosFicha): string | null {
  const x = ev.detalhe ?? {};
  switch (ev.tipo) {
    case 'recebida': return 'Recebida';
    case 'coleta_minima': {
      const et = Object.entries((x.etapas ?? {}) as Obj);
      return 'Coleta mínima' + (et.length ? ' · ' + et.map(([k, v]) => `${ETAPA_COLETA[k] ?? k}: ${statusTxt(v)}`).join('; ') : '');
    }
    case 'qualificada': {
      if (x.decisao === 'descartar') return 'Qualificação · spam';
      const q = d.f.qualificacao ?? {};
      const assunto = ASSUNTO[q.classificacaoMensagem?.falaDeProblemaOuFerramenta];
      const tec = TECNOLOGIA[q.estruturaTecnologia?.categoria];
      const p = q.portaIndicada?.porta;
      const porta = !p ? null : p === 'indeterminada' ? 'nenhuma porta indicada' : `porta ${PORTA[p] ?? p} indicada`;
      const partes = [assunto, tec, porta].filter(Boolean);
      return 'Qualificação' + (partes.length ? ' · ' + partes.join('; ') : '');
    }
    case 'triada':
      return `Triagem · ${QUAD[x.quadrante as keyof typeof QUAD] ?? x.quadrante}, grau ${x.grau}, ${x.pontos} pontos → ${DESTINO_TRIAGEM[x.proximoEstado] ?? x.proximoEstado}`;
    case 'coleta_iniciada':
      return x.passagem === 'reexecucao' ? `Coleta · reexecução: ${juntar(((x.etapas ?? []) as string[]).map((e) => ETAPA_COLETA[e] ?? e))}` : null;
    case 'coleta_etapa': {
      const nome = ETAPA_COLETA[x.etapa] ?? x.etapa;
      if (x.parte) return `Coleta · ${nome} (${x.parte === 'instagram' ? 'Instagram' : x.parte}): ${statusTxt(x.status)}`;
      const conf = x.status === 'concluida' ? d.coleta[x.etapa]?.confianca?.grau : null;
      return `Coleta · ${nome}: ${statusTxt(x.status)}${conf ? `, confiança ${CONF[conf as keyof typeof CONF] ?? conf}` : ''}`;
    }
    case 'graduada':
      return `Análise · enquadramento concluído → ${QUAD[x.quadrante as keyof typeof QUAD] ?? x.quadrante}, grau ${x.grau}, ${x.pontos} pontos` +
        (x.escopo === 'ressalva' ? ', grau limitado a B pela ressalva de escopo' : x.escopo === 'barrado' ? ', grau D pelo escopo barrado' : '');
    case 'sintese': return `Síntese · análise ${x.versao ?? ''}`.trim();
    case 'verificacao': {
      const n = Number(x.pendencias ?? 0), pt: Obj = x.porTipo ?? {};
      const det = [pt.escopo ? `${pt.escopo} de escopo` : '', pt.estrutura ? `${pt.estrutura} de estrutura` : ''].filter(Boolean).join(', ');
      const conf = x.confianca ? ` → confiança ${CONF[x.confianca as keyof typeof CONF] ?? x.confianca}` : '';
      return `Verificação · ${x.versao}: ${n ? plural(n, 'pendência', 'pendências') + (det ? ` (${det})` : '') : 'sem pendências'}${conf}`;
    }
    case 'reparo':
      return `Reparo · ${ETAPA_TEXTO[x.etapa] ?? x.etapa} · ${((x.regras ?? []) as string[]).map((r) => nomeRegra(r)).join(', ')} · ${x.aceito ? 'aceito' : 'rejeitado'}`;
    case 'correcao':
      return `Correção · ${x.versao} a partir de ${x.versaoBase}: ${plural(Number(x.corrigidas ?? 0), 'corrigida', 'corrigidas')}, ${Number(x.semAlteracao ?? 0)} sem alteração, ${plural(Number(x.mantidas ?? 0), 'mantida', 'mantidas')}`;
    case 'parada': return `Ficha parada · ${ESTADO[x.estado] ?? x.estado} sem avanço por ${x.minutos} minutos`;
    case 'teto_diario': return `Análise adiada · teto diário de ${x.teto} análises atingido em ${diaTxt(x.dia)}`;
    case 'retencao_liberada':
      return `Retenção liberada · ${x.modo === 'manual' ? 'manual' : 'automática'}` + (x.motivo ? ` (${RETENCAO_CURTO[x.motivo] ?? x.motivo})` : '');
    case 'custo_sem_preco': return `Custo não estimado · ${x.chamada} (${x.modelo}) sem preço na tabela`;
    default: return ACOES[ev.tipo] ? ACOES[ev.tipo](x) : ev.tipo;
  }
}
const ETAPAS_SINTESE: [string, string][] = [['enquadrar', 'Enquadramento'], ['preparar_conversa', 'Preparação da conversa'], ['montar_analise', 'Montagem da análise']];
function pipelineHTML(d: DadosFicha): string {
  const itens = d.eventos.map((ev) => [ev, eventoTxt(ev, d)] as const).filter(([, t]) => t !== null);
  let h = '<div class="panel"><h3>Pipeline de análise</h3>' + (itens.length
    ? '<ol class="steps">' + itens.map(([ev, t]) => `<li><span class="t">${esc(quando(ev.em))}</span><span>${esc(t)}</span></li>`).join('') + '</ol>'
    : '<p class="empty">Nenhum evento registrado.</p>');
  const s = d.f.sinteseEmCurso;
  if (d.f.estado === 'sintetizando' && s) {
    const feitas = ETAPAS_SINTESE.filter(([k]) => s[k]);
    h += `<p class="help" style="margin-top:var(--space-4)">Síntese em curso · etapas concluídas${isDate(s.atualizadoEm) ? ` · atualizado às ${horaSP(s.atualizadoEm)}` : ''}</p>` +
      (feitas.length ? '<ol class="steps">' + feitas.map(([, n]) => `<li><span class="t">✓</span><span>${n}</span></li>`).join('') + '</ol>' : '<p class="empty">Nenhuma etapa concluída ainda.</p>');
  }
  return h + '</div>';
}

// ---------- Technical diagnosis (spec 05 §5.4) ----------
const SUB = (s: string) => `<p class="aqt" style="margin:var(--space-4) 0 var(--space-2);font:500 11px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">${s}</p>`;
function diagnosticoHTML(a: Analise | null, analises: Analise[]): string {
  if (!a) return '';
  const v = a.d.verificacao ?? {};
  const av: string[] = v.avisos ?? [], rp: Obj[] = v.reparos ?? [];
  const correcao = a.d.autor?.origem === 'correcao' && a.d.baseadaEm;
  const base = correcao ? analises.find((x) => x.id === a.d.baseadaEm) : null;
  const ck: Obj[] | null = (correcao ? base?.d.verificacao?.checklist : v.checklist) ?? null;
  const temCk = !!ck && ck.length > 0;
  if (!av.length && !rp.length && !temCk) return '';
  let b = SUB('Avisos') + (av.length ? '<ul class="qwhy" style="padding-left:1.1em;margin:0">' + av.map((x) => `<li>${esc(avisoTxt(String(x)))}</li>`).join('') + '</ul>' : '<p class="qwhy" style="margin:0">Nenhum aviso.</p>');
  b += SUB('Reparos') + (rp.length ? '<ul class="pend">' + rp.map((r) =>
    `<li><p class="pt" style="font:500 11px/1.4 var(--mono);letter-spacing:.08em">${esc(cap(nomeRegra(r.regra)))} · ${esc(secaoDoLocal(r.local))} · ${r.aceito ? 'aceito' : 'rejeitado'}</p>` +
    `<p class="cs" style="margin:0">${esc(ETAPA_TEXTO[r.etapa] ?? r.etapa ?? '')}</p><p class="tr">Antes: "${esc(r.trechoAntes ?? '')}"</p><p class="tr">Depois: "${esc(r.trechoDepois ?? '')}"</p></li>`).join('') + '</ul>'
    : '<p class="qwhy" style="margin:0">Nenhum reparo.</p>');
  if (temCk) {
    const conta = (r: string) => ck!.filter((i) => i.resultado === r).length;
    const nome = (i: Obj) => i.regraNome || i.regra;
    b += SUB('Checklist do revisor' + (correcao ? ` · da ${esc(a.d.baseadaEm)}, base desta correção` : '')) +
      `<p class="qwhy" style="margin:0 0 var(--space-3)">${ck!.length} itens: ${conta('conforme')} conformes, ${plural(conta('violado'), 'violado', 'violados')}, ${conta('nao_aplicavel')} não se aplica</p>`;
    const topo = ck!.filter((i) => i.resultado !== 'conforme').sort((x, y) => (x.resultado === 'violado' ? 0 : 1) - (y.resultado === 'violado' ? 0 : 1));
    if (topo.length) b += '<ul class="pend">' + topo.map((i) => `<li${i.resultado === 'violado' ? ' class="esc"' : ''}><p class="pt" style="font:500 11px/1.4 var(--mono);letter-spacing:.08em">${CK_RES[i.resultado] ?? esc(i.resultado)}${i.secao ? ' · ' + esc(secaoTxt(i.secao)) : ''}</p><p class="tr">${esc(nome(i))}</p>${i.trecho ? `<p class="cs">Trecho: "${esc(i.trecho)}"</p>` : ''}</li>`).join('') + '</ul>';
    const conf = ck!.filter((i) => i.resultado === 'conforme');
    if (conf.length) b += `<p class="qwhy" style="margin:var(--space-3) 0 0">Conformes: ${conf.map((i) => esc(nome(i))).join(' · ')}</p>`;
  }
  const titulo = `${plural(av.length, 'aviso', 'avisos')} · ${plural(rp.length, 'reparo', 'reparos')}${temCk ? ' · checklist do revisor' : ''}`;
  return `<div class="panel"><div class="facc" style="margin-top:0;border-top:0"><details data-k="diag" style="border-bottom:0"><summary><span>Diagnóstico técnico<small>${titulo}</small></span><span class="pl" aria-hidden="true"></span></summary><div class="body"><div>${b}</div></div></details></div></div>`;
}

// ---------- Whole body ----------
/** The version shown: the chosen one when it still exists, else analiseAtual, else the newest. */
export function versaoExibida(d: DadosFicha, escolhida: string | null): Analise | null {
  return d.analises.find((a) => a.id === escolhida) ?? d.analises.find((a) => a.id === d.f.analiseAtual) ?? d.analises[0] ?? null;
}
export function corpoHTML(d: DadosFicha, escolhida: string | null, hoje: Date): string {
  const a = versaoExibida(d, escolhida);
  const atual = d.analises.find((x) => x.id === d.f.analiseAtual) ?? null;
  let h = '';
  if (d.analises.length) {
    h += `<div class="ver">${seletorHTML('aVer', 'Versão da análise', d.analises.map((x) => [x.id, x.id, versaoDesc(x)]), a!.id)}<span>nova versão a cada reexecução ou edição; as anteriores ficam guardadas</span></div>`;
  }
  h += '<div class="detail"><div style="display:flex;flex-direction:column;gap:var(--space-6);min-width:0">' +
    (a ? pendenciasHTML(a) : '') + erroHTML(d) + fichaRecebidaHTML(d) + pessoasHTML(d) + avaliacaoHTML(d, a) +
    '</div><div style="display:flex;flex-direction:column;gap:var(--space-6);min-width:0">' +
    qualificacaoHTML(d.f, atual, hoje) + pipelineHTML(d) + diagnosticoHTML(a, d.analises) + '</div></div>';
  return h;
}
