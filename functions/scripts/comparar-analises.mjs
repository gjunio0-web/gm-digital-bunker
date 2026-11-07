// Side-by-side comparison of the analysis versions of the test fichas (phase B, Haiku × Sonnet synthesis).
// Read-only: reads fichas with teste = true that have analise/vN and writes one self-contained HTML page,
// styled with the GM Digital Bunker Design System tokens (dark default, light by the theme switch). Each
// ficha lists all its versions; columns A and B default to the latest Sonnet version and the latest Haiku
// version. The page carries the analysis texts, so it is for the administrator only and is not committed.
// Usage: node scripts/comparar-analises.mjs <project id> <output.html>
import { writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const [projeto, saida] = process.argv.slice(2);
if (!projeto || !saida) {
  console.error('Usage: node scripts/comparar-analises.mjs <project id> <output.html>');
  process.exit(1);
}
initializeApp({ projectId: projeto });
const db = getFirestore();

const data = (t) => t?.toDate?.().toISOString() ?? null;
const fichas = [];
for (const f of (await db.collection('fichas').where('teste', '==', true).get()).docs) {
  const analises = (await f.ref.collection('analise').get()).docs;
  if (!analises.length) continue;
  const graduadas = Object.fromEntries(
    (await f.ref.collection('eventos').where('tipo', '==', 'graduada').get()).docs.map((e) => [e.get('detalhe.versao'), e.get('detalhe')]),
  );
  const versoes = analises
    .map((a) => {
      const x = a.data();
      return {
        id: a.id,
        n: Number(a.id.slice(1)),
        modelo: x.autor?.id ?? '?',
        autor: x.autor?.tipo ?? '?',
        esforco: x.uso?.esforco ?? 'padrão do modelo',
        criadaEm: data(x.criadaEm),
        uso: x.uso ?? {},
        lead: graduadas[a.id] ?? null,
        enquadramento: x.enquadramento ?? {},
        verificacao: x.verificacao ?? null,
        resumoExecutivo: x.resumoExecutivo ?? '',
        rascunhoResposta: x.rascunhoResposta ?? null,
        conversa: x.conversa ?? null,
        secoes: x.secoes ?? {},
      };
    })
    .sort((a, b) => a.n - b.n);
  fichas.push({ id: f.id, empresa: f.get('original.empresa'), estado: f.get('estado'), analiseAtual: f.get('analiseAtual'), versoes });
}
fichas.sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'));
const json = JSON.stringify({ geradoEm: new Date().toISOString(), projeto, fichas }).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="pt-BR" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comparação de análises</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* GM Digital Bunker Design System tokens (site src/styles/global.css) */
:root{
  --dur-fast:150ms; --dur-base:200ms; --ease-out:cubic-bezier(0.2,0,0,1);
  --bg:#0b0d10; --surface:#161632; --surface-raised:#161632; --line:#2a2f37; --line-strong:#666e7a;
  --ink:#eceef1; --ink-body:#c7ccd3; --muted:#959da8; --accent:#3d7bff; --accent-hover:#6a99ff; --on-accent:#0b0d10;
  --selection:#1d3a7a;
  --serif:'Source Serif 4',Georgia,serif; --sans:'Source Sans 3',system-ui,sans-serif; --mono:'JetBrains Mono',ui-monospace,monospace;
  --gutter:clamp(16px,3.4vw,48px); --container:76rem; --radius-sm:2px; --radius-md:4px; --header-h:64px;
}
html[data-theme="light"]{
  --bg:#f6f6f4; --surface:#f1f0fd; --surface-raised:#f1f0fd; --line:#dadde2; --line-strong:#808792;
  --ink:#111418; --ink-body:#2b3038; --muted:#5a626e; --accent:#1a56db; --accent-hover:#1544b0; --on-accent:#ffffff; --selection:#cfdcfb;
}
*{box-sizing:border-box}
*{scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
body{margin:0;background:var(--bg);color:var(--ink-body);font-family:var(--sans);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased;
  transition:background-color var(--dur-base) var(--ease-out),color var(--dur-base) var(--ease-out)}
::selection{background:var(--selection);color:var(--ink)}
a{color:var(--accent);text-underline-offset:4px;text-decoration-thickness:1px}
a:hover{color:var(--accent-hover)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:var(--radius-sm)}
button,select{font:inherit}
.container{max-width:var(--container);margin:0 auto;padding-left:var(--gutter);padding-right:var(--gutter)}
header.top{position:sticky;top:0;z-index:10;height:var(--header-h);background:var(--bg);border-bottom:1px solid var(--line)}
header.top .container{height:100%;display:flex;align-items:center;justify-content:space-between;gap:16px}
.marca{font-family:var(--serif);font-weight:600;font-size:19px;color:var(--ink);white-space:nowrap}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.btn{background:transparent;color:var(--ink);border:1px solid var(--line-strong);border-radius:var(--radius-md);padding:6px 12px;cursor:pointer;
  transition:border-color var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.btn:hover{border-color:var(--ink)}
.btn{white-space:nowrap}
@media(max-width:479px){header.top .eyebrow{display:none}}
.abertura{padding:40px 0 24px}
h1{margin:8px 0 8px;font-family:var(--serif);font-weight:600;font-size:clamp(30px,4vw,48px);line-height:1.08;color:var(--ink)}
h2{margin:0;font-family:var(--serif);font-weight:600;font-size:clamp(22px,2.2vw,28px);line-height:1.2;color:var(--ink)}
h3{margin:0 0 8px;font-family:var(--serif);font-weight:600;font-size:20px;color:var(--ink)}
.lead{color:var(--muted);max-width:46rem;margin:0}
.controles{display:grid;gap:12px;grid-template-columns:1fr;padding:16px 0 24px;border-bottom:1px solid var(--line)}
@media(min-width:768px){.controles{grid-template-columns:2fr 1fr 1fr}}
label.campo{display:flex;flex-direction:column;gap:4px}
select{background:var(--surface);color:var(--ink);border:1px solid var(--line-strong);border-radius:var(--radius-md);padding:8px 10px;width:100%}
.par{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:900px){.par{grid-template-columns:1fr 1fr}}
.bloco{padding:28px 0;border-bottom:1px solid var(--line)}
.bloco>.cab{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-md);padding:16px 18px;min-width:0}
.card .rot{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}
.lado{font-family:var(--mono);font-size:12px;color:var(--ink);border:1px solid var(--line-strong);border-radius:var(--radius-sm);padding:1px 6px}
.lado.b{border-style:dashed}
.meta{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:15px;margin:0}
.meta dt{font-family:var(--mono);font-size:12px;color:var(--muted);padding-top:3px}
.meta dd{margin:0;color:var(--ink)}
.texto{font-size:16px;overflow-wrap:anywhere}
.texto p{margin:0 0 10px}
.texto ul,.texto ol{margin:0 0 10px;padding-left:22px}
.texto h4{margin:12px 0 6px;font-family:var(--sans);font-weight:600;color:var(--ink);font-size:16px}
.texto strong{color:var(--ink);font-weight:600}
.texto blockquote{margin:0 0 10px;padding-left:12px;border-left:2px solid var(--line-strong);color:var(--muted)}
.marca-f{font-family:var(--mono);font-size:11px;vertical-align:super;text-decoration:none}
.inf{font-family:var(--mono);font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:var(--radius-sm);padding:0 4px}
.vazia{color:var(--muted);font-style:italic}
.contagem{font-family:var(--mono);font-size:12px;color:var(--muted)}
.pend{list-style:none;padding:0;margin:0}
.pend li{padding:8px 0;border-top:1px solid var(--line);font-size:15px}
.pend li:first-child{border-top:0}
.tag{font-family:var(--mono);font-size:11px;color:var(--ink);border:1px solid var(--line-strong);border-radius:var(--radius-sm);padding:0 5px;margin-right:6px}
.tag.escopo{border-width:2px;border-color:var(--ink)}
.dif{color:var(--accent)}
footer{padding:32px 0 48px;color:var(--muted);font-size:14px}
</style>
</head>
<body>
<header class="top"><div class="container">
  <div style="display:flex;align-items:baseline;gap:14px;min-width:0"><span class="marca">GM Digital Bunker™</span><span class="eyebrow">Administração</span></div>
  <button class="btn" id="tema" type="button" aria-label="Alternar tema">Tema claro</button>
</div></header>
<main class="container">
  <section class="abertura">
    <p class="eyebrow">Fase B · Teste comparativo da síntese</p>
    <h1>Comparação de análises</h1>
    <p class="lead">Versões da análise preliminar de cada ficha de teste, lado a lado. As colunas A e B começam na última versão do Claude Sonnet 5.5 e na última do Claude Haiku 5.5; qualquer versão pode ser escolhida nos seletores. O revisor é sempre o Sonnet 5.5.</p>
  </section>
  <section class="controles" aria-label="Escolha da ficha e das versões">
    <label class="campo"><span class="eyebrow">Ficha</span><select id="ficha"></select></label>
    <label class="campo"><span class="eyebrow">Coluna A</span><select id="va"></select></label>
    <label class="campo"><span class="eyebrow">Coluna B</span><select id="vb"></select></label>
  </section>
  <div id="conteudo"></div>
  <footer id="rodape"></footer>
</main>
<script>
const D = ${json};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nomeModelo = (m) => /haiku/.test(m) ? 'Claude Haiku 5.5' : /sonnet/.test(m) ? 'Claude Sonnet 5.5' : m;
const usd = (v) => 'US$ ' + (v ?? 0).toFixed(4).replace('.', ',');
const quando = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '–';
const rotulo = { priorizar: 'Priorizar', qualificar: 'Qualificar', nutrir: 'Nutrir', declinar: 'Declinar', convidar: 'Convidar', verificar_aderencia: 'Verificar a aderência', encerrar: 'Encerrar com cortesia' };
const palavras = (t) => (String(t ?? '').replace(/\\[F:[a-z_]+:\\d+\\](\\([^)]*\\))?/g, ' ').match(/[\\p{L}\\p{N}]+/gu) ?? []).length;

// Inline Markdown: escape first, then marks, links, bold, italic, inference tag.
function inline(t) {
  let s = esc(t);
  s = s.replace(/\\[F:([a-z_]+):(\\d+)\\]\\((https?:[^)\\s]+)\\)/g, (m, e, i, u) => '<a class="marca-f" href="' + u + '" target="_blank" rel="noopener">' + e.replace('empresa_', '') + ':' + i + '</a>');
  s = s.replace(/\\[F:([a-z_]+):(\\d+)\\]/g, (m, e, i) => '<span class="marca-f">' + e.replace('empresa_', '') + ':' + i + '</span>');
  s = s.replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>');
  s = s.replace(/\\[inferência\\]/g, '<span class="inf">inferência</span>');
  return s;
}
// Block Markdown: headings, lists, quotes, paragraphs.
function md(t) {
  if (!t) return '<p class="vazia">sem texto</p>';
  const out = [];
  let lista = null;
  const fecha = () => { if (lista) { out.push('</' + lista + '>'); lista = null; } };
  for (const linha of String(t).split('\\n')) {
    const l = linha.trimEnd();
    let m;
    if (!l.trim()) { fecha(); continue; }
    if ((m = /^#{1,6}\\s+(.*)/.exec(l))) { fecha(); out.push('<h4>' + inline(m[1]) + '</h4>'); continue; }
    if ((m = /^\\s*[-*]\\s+(.*)/.exec(l))) { if (lista !== 'ul') { fecha(); lista = 'ul'; out.push('<ul>'); } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
    if ((m = /^\\s*\\d+[.)]\\s+(.*)/.exec(l))) { if (lista !== 'ol') { fecha(); lista = 'ol'; out.push('<ol>'); } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
    if ((m = /^>\\s?(.*)/.exec(l))) { fecha(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    fecha();
    out.push('<p>' + inline(l) + '</p>');
  }
  fecha();
  return out.join('');
}

function opcoes(f) {
  return f.versoes.map((v) => '<option value="' + v.id + '">' + v.id + ' · ' + esc(nomeModelo(v.modelo)) + ' · esforço ' + esc(v.esforco) + (v.autor === 'humano' ? ' · edição humana' : '') + (v.id === f.analiseAtual ? ' · atual' : '') + '</option>').join('');
}
function padrao(f, re) {
  const vs = f.versoes.filter((v) => re.test(v.modelo));
  return (vs[vs.length - 1] ?? f.versoes[f.versoes.length - 1]).id;
}

function resumo(v, lado) {
  const u = v.uso ?? {};
  const ch = u.chamadas ?? {};
  const dur = Object.values(ch).reduce((t, c) => t + (c.duracaoMs ?? 0), 0);
  const ps = v.verificacao?.pendencias ?? [];
  const tipos = ps.reduce((t, p) => (t[p.tipo] = (t[p.tipo] ?? 0) + 1, t), {});
  const l = v.lead;
  return '<div class="card"><div class="rot"><span class="lado ' + lado + '">' + lado.toUpperCase() + '</span><span class="contagem">' + v.id + '</span></div>' +
    '<h3>' + esc(nomeModelo(v.modelo)) + '</h3><dl class="meta">' +
    '<dt>esforço</dt><dd>' + esc(v.esforco) + '</dd>' +
    '<dt>criada em</dt><dd>' + quando(v.criadaEm) + '</dd>' +
    '<dt>análise</dt><dd>' + (l ? esc(rotulo[l.quadrante] ?? l.quadrante) + ' ' + esc(l.grau) + ' · ' + l.pontos + ' pontos · ' + esc(rotulo[l.destino] ?? l.destino) : '–') + '</dd>' +
    '<dt>escopo</dt><dd>' + esc(v.enquadramento?.escopo ?? '–') + ' · porta ' + esc(v.enquadramento?.portaProvavel ?? '–') + '</dd>' +
    '<dt>riscos</dt><dd>' + esc((v.enquadramento?.riscos ?? []).join(', ') || 'nenhum') + '</dd>' +
    '<dt>custo</dt><dd>síntese ' + usd((u.usdEstimado ?? 0) - (u.revisor?.usdEstimado ?? 0)) + ' · revisor ' + usd(u.revisor?.usdEstimado) + ' · total ' + usd(u.usdEstimado) + '</dd>' +
    '<dt>tokens</dt><dd>' + Object.entries(ch).map(([k, c]) => esc(k) + ' ' + c.tokensEntrada + '/' + c.tokensSaida).join(' · ') + '</dd>' +
    '<dt>tempo</dt><dd>' + (dur ? Math.round(dur / 1000) + ' s nas três chamadas' : 'não medido') + '</dd>' +
    '<dt>verificação</dt><dd>' + esc(v.verificacao?.status ?? '–') + ' · ' + ps.length + ' pendências' + (ps.length ? ' (' + Object.entries(tipos).map(([k, n]) => esc(k) + ' ' + n).join(', ') + ')' : '') + '</dd>' +
    '</dl></div>';
}

function par(titulo, a, b, fa, fb, contar = true) {
  const na = contar ? palavras(fa) : null, nb = contar ? palavras(fb) : null;
  return '<section class="bloco"><div class="cab"><h2>' + esc(titulo) + '</h2>' +
    (contar ? '<span class="contagem">A ' + na + ' · B ' + nb + ' palavras</span>' : '') + '</div>' +
    '<div class="par"><div class="card texto"><div class="rot"><span class="lado a">A</span></div>' + a + '</div>' +
    '<div class="card texto"><div class="rot"><span class="lado b">B</span></div>' + b + '</div></div></section>';
}

const secao = (v, k) => {
  const s = v.secoes?.[k];
  if (!s) return { html: '<p class="vazia">seção ausente</p>', bruto: '' };
  if (s.vazia) return { html: '<p class="vazia">Seção vazia: ' + esc(s.motivoVazia ?? '') + '</p>', bruto: '' };
  return { html: md(s.corpo), bruto: s.corpo };
};
const rascunho = (v) => v.rascunhoResposta ? '<p><strong>' + esc(v.rascunhoResposta.assunto) + '</strong></p>' + md(v.rascunhoResposta.corpo) : '<p class="vazia">sem rascunho</p>';
const perguntas = (v) => {
  const c = v.conversa ?? {};
  const p = (c.perguntas ?? []).map((x) => '<li>' + inline(x.pergunta) + '<br><span class="contagem">' + esc(x.lacunaOuHipotese) + '</span></li>').join('');
  const m = (c.materiais ?? []).map((x) => '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.nome) + '</a> – ' + esc(x.porQue) + '</li>').join('');
  const a = (c.pontosDeAtencao ?? []).map((x) => '<li>' + inline(x) + '</li>').join('');
  return '<h4>Perguntas</h4><ol>' + (p || '<li class="vazia">nenhuma</li>') + '</ol><h4>Materiais</h4><ul>' + (m || '<li class="vazia">nenhum</li>') + '</ul><h4>Pontos de atenção</h4><ul>' + (a || '<li class="vazia">nenhum</li>') + '</ul>';
};
const pendencias = (v) => {
  const ps = [...(v.verificacao?.pendencias ?? [])].sort((x, y) => (y.tipo === 'escopo') - (x.tipo === 'escopo'));
  if (!ps.length) return '<p class="vazia">sem pendências</p>';
  return '<ul class="pend">' + ps.map((p) => '<li><span class="tag' + (p.tipo === 'escopo' ? ' escopo' : '') + '">' + esc(p.tipo) + (p.regra ? ' · ' + esc(p.regra) : '') + '</span><span class="contagem">' + esc(p.secao) + '</span><br>' + esc(p.trecho ?? p.texto ?? '') + (p.correcaoSugerida ? '<br><span class="contagem">correção: ' + esc(p.correcaoSugerida) + '</span>' : '') + '</li>').join('') + '</ul>';
};

function desenha() {
  const f = D.fichas.find((x) => x.id === $('#ficha').value);
  const a = f.versoes.find((v) => v.id === $('#va').value);
  const b = f.versoes.find((v) => v.id === $('#vb').value);
  const blocos = ['<section class="bloco"><div class="cab"><h2>' + esc(f.empresa) + '</h2><span class="contagem">' + esc(f.id) + ' · ' + esc(f.estado) + '</span></div><div class="par">' + resumo(a, 'a') + resumo(b, 'b') + '</div></section>'];
  blocos.push(par('Resumo executivo', md(a.resumoExecutivo), md(b.resumoExecutivo), a.resumoExecutivo, b.resumoExecutivo));
  for (const k of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) {
    const x = secao(a, k), y = secao(b, k);
    blocos.push(par(k + ' · ' + (a.secoes?.[k]?.titulo ?? b.secoes?.[k]?.titulo ?? ''), x.html, y.html, x.bruto, y.bruto));
  }
  blocos.push(par('Rascunho da resposta', rascunho(a), rascunho(b), a.rascunhoResposta?.corpo, b.rascunhoResposta?.corpo));
  blocos.push(par('Preparação da conversa', perguntas(a), perguntas(b), null, null, false));
  blocos.push(par('Pendências da verificação', pendencias(a), pendencias(b), null, null, false));
  $('#conteudo').innerHTML = blocos.join('');
}

function trocaFicha() {
  const f = D.fichas.find((x) => x.id === $('#ficha').value);
  $('#va').innerHTML = opcoes(f);
  $('#vb').innerHTML = opcoes(f);
  $('#va').value = padrao(f, /sonnet/);
  $('#vb').value = padrao(f, /haiku/);
  desenha();
}

$('#ficha').innerHTML = D.fichas.map((f) => '<option value="' + f.id + '">' + esc(f.empresa) + ' · ' + f.versoes.length + ' versões</option>').join('');
$('#ficha').addEventListener('change', trocaFicha);
$('#va').addEventListener('change', desenha);
$('#vb').addEventListener('change', desenha);
$('#tema').addEventListener('click', () => {
  const claro = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = claro ? 'light' : 'dark';
  $('#tema').textContent = claro ? 'Tema escuro' : 'Tema claro';
});
$('#rodape').textContent = 'Gerado em ' + quando(D.geradoEm) + ' a partir do projeto ' + D.projeto + '. Uso interno: contém o texto das análises.';
if (D.fichas.length) trocaFicha(); else $('#conteudo').innerHTML = '<p class="vazia">Nenhuma ficha de teste com análise.</p>';
</script>
</body>
</html>
`;
writeFileSync(saida, html);
console.log(`${saida}: ${fichas.length} fichas, ${fichas.reduce((t, f) => t + f.versoes.length, 0)} versões, ${Math.round(html.length / 1024)} KB`);
