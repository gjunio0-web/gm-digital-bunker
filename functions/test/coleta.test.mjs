// Collection helpers: CNPJ, address guard, site parsing, provider filters, envelope rules, prompts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { cnpjValido, extraiCnpjs, filtraBrasilApi } from '../lib/coleta/cnpj.js';
import { exigeEnderecoPublico, ipPrivado } from '../lib/coleta/rede.js';
import { instagramDe, linksDe, tecnologiasDe, textoDe } from '../lib/coleta/site.js';
import { filtraHunter } from '../lib/coleta/fornecedores.js';
import { formatoInvalido, normalizaEnvelope } from '../lib/coleta/envelope.js';
import { chaveUrl, extraiJson, urlsDosResultados } from '../lib/coleta/claudeColeta.js';
import { CHAVES, ETAPAS, mensagemDaEtapa, orcamentoBuscas } from '../lib/coleta/etapas.js';
import { ESQUEMAS } from '../lib/coleta/textosSpec.js';
import { custoDe } from '../lib/custo.js';

test('CNPJ: check digits, extraction from text with and without punctuation', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cnpjValido('00000000000000'), false);
  assert.deepEqual(extraiCnpjs('Razão social X – CNPJ 11.222.333/0001-81. Outro: 11222333000182 e 11222333000181'), ['11222333000181']);
});

test('BrasilAPI: partners keep name and role only', () => {
  const r = filtraBrasilApi('11222333000181', { razao_social: 'ACME LTDA', qsa: [{ nome_socio: 'Ana', qualificacao_socio: 'Sócia', cnpj_cpf_do_socio: '***123***' }], cnae_fiscal: 6201501, cnae_fiscal_descricao: 'Software' });
  assert.deepEqual(r.quadroSocietario, [{ nome: 'Ana', qualificacao: 'Sócia' }]);
  assert.deepEqual(r.cnaePrincipal, { codigo: '6201501', descricao: 'Software' });
  assert.equal(JSON.stringify(r).includes('123'), false);
});

test('address guard: private, loopback, metadata and non-http are refused', async () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.0.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(ipPrivado(ip), true, ip);
  for (const ip of ['8.8.8.8', '200.147.67.142', '2001:4860:4860::8888']) assert.equal(ipPrivado(ip), false, ip);
  await assert.rejects(exigeEnderecoPublico(new URL('http://169.254.169.254/computeMetadata/v1/')));
  await assert.rejects(exigeEnderecoPublico(new URL('file:///etc/passwd')));
  await assert.rejects(exigeEnderecoPublico(new URL('http://localhost:8080/')));
  await assert.rejects(exigeEnderecoPublico(new URL('http://[::1]/')));
});

test('site parsing: text without scripts, same-site links, Instagram profile, technologies', () => {
  const html = `<html><head><title>ACME</title><meta name="generator" content="WordPress 6.5"><script>var x=1</script></head>
    <body><nav><a href="/sobre">Sobre</a><a href="https://www.acme.com.br/servicos#x">Serviços</a><a href="https://outro.com/">Fora</a>
    <a href="https://instagram.com/p/abc">post</a><a href="https://www.instagram.com/acme.oficial/">IG</a></nav>
    <p>Fabricamos  peças.</p><style>.a{}</style><script src="https://www.googletagmanager.com/gtm.js"></script></body></html>`;
  const raiz = parse(html);
  const base = new URL('https://acme.com.br/');
  assert.deepEqual(linksDe(raiz, base).map((u) => u.pathname), ['/sobre', '/servicos']);
  assert.equal(instagramDe(raiz), 'acme.oficial');
  const tec = tecnologiasDe(html, { server: 'nginx' });
  assert.ok(tec.includes('WordPress 6.5') && tec.includes('Google Tag Manager') && tec.includes('servidor: nginx'));
  const t = textoDe(raiz);
  assert.match(t, /Fabricamos peças\./);
  assert.doesNotMatch(t, /var x|\.a\{/);
});

test('Hunter: only the fields of spec 03 table 5.1 survive', () => {
  const h = filtraHunter({ phone: '+55 11 9', linkedin: 'x', bio: 'y', employment: { title: 'Diretor', role: 'operations', subRole: 'x', seniority: 'executive', name: 'ACME', domain: 'acme.com.br' }, geo: { city: 'Joinville', state: 'SC', country: 'BR' } });
  assert.deepEqual(Object.keys(h).sort(), ['cargo', 'cidade', 'dominioEmpresa', 'empresaAtual', 'estado', 'funcao', 'pais', 'senioridade', 'subfuncao']);
  assert.equal(JSON.stringify(h).includes('+55'), false);
});

const env = (fontes, afirmacoes, conteudo = { oQueVende: 'peças' }) => ({ conteudo, fontes, afirmacoes, confianca: { grau: 'alta', motivo: 'ok' } });

test('envelope: missing stage keys and bad statements are reported', () => {
  assert.match(formatoInvalido(env([], []), CHAVES.empresa_noticias), /itens/);
  assert.equal(formatoInvalido(env([], [], { itens: [], leitura: null }), CHAVES.empresa_noticias), null);
  assert.match(formatoInvalido({ ...env([], [{ texto: 'x', tipo: 'talvez', fonteIdx: [] }], { itens: [], leitura: null }) }, CHAVES.empresa_noticias), /afirmacoes/);
});

test('envelope: unverified sources removed, indices remapped, confidence lowered', () => {
  const bruto = env(
    [{ url: 'https://acme.com.br/', titulo: 'Home', tipo: 'pagina' }, { url: 'https://inventado.com/x', titulo: '?', tipo: 'busca' }, { url: 'https://news.com/a', titulo: 'N', tipo: 'busca' }],
    [{ texto: 'a', tipo: 'fato', fonteIdx: [2] }, { texto: 'b', tipo: 'fato', fonteIdx: [1] }, { texto: 'c', tipo: 'nao_encontrado', fonteIdx: [] }],
  );
  const n = normalizaEnvelope(bruto, new Set([chaveUrl('https://www.acme.com.br'), chaveUrl('https://news.com/a/')]), '2026-11-06T00:00:00Z');
  assert.deepEqual(n.fontes.map((f) => f.url), ['https://acme.com.br/', 'https://news.com/a']);
  assert.deepEqual(n.afirmacoes.map((a) => a.fonteIdx), [[1], [], []]);
  assert.equal(n.confianca.grau, 'baixa');
  assert.match(n.confianca.motivo, /1 fonte\(s\) não verificada\(s\)/);
  assert.match(n.confianca.motivo, /1 afirmação\(ões\) sem fonte/);
});

test('envelope: content with values and no sourced statement gets "campos sem fonte"; clean envelope keeps its grade', () => {
  const sem = normalizaEnvelope(env([], [{ texto: 'x', tipo: 'nao_encontrado', fonteIdx: [] }]), new Set(), 'now');
  assert.match(sem.confianca.motivo, /campos sem fonte/);
  const limpo = normalizaEnvelope(env([{ url: 'https://a.com', titulo: 'A', tipo: 'busca' }], [{ texto: 'x', tipo: 'fato', fonteIdx: [0] }]), new Set(['a.com']), 'now');
  assert.equal(limpo.confianca.grau, 'alta');
  const vazio = normalizaEnvelope(env([], [{ texto: 'nada', tipo: 'nao_encontrado', fonteIdx: [] }], { itens: [], leitura: null }), new Set(), 'now');
  assert.equal(vazio.confianca.grau, 'alta');
});

test('answer parsing: JSON inside text, URLs from search and fetch results', () => {
  assert.deepEqual(extraiJson('Aqui está:\n{"a": {"b": 1}}\nfim'), { a: { b: 1 } });
  assert.throws(() => extraiJson('sem json'));
  // text with braces after the object (the Capal failure in the phase 3 run)
  assert.deepEqual(extraiJson('{"a": "x}y", "b": [1]}\nObs.: {nota} final'), { a: 'x}y', b: [1] });
  assert.deepEqual(extraiJson('Antes {não é json} depois {"ok": true}'), { ok: true });
  assert.deepEqual(extraiJson('{"q": "aspas \\" e } dentro"}'), { q: 'aspas " e } dentro' });
  const urls = urlsDosResultados([
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://x.com/1' }, { type: 'web_search_result', url: 'https://y.com' }] },
    { type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: 'https://z.com/p' } },
    { type: 'text', text: 'https://not-a-result.com' },
  ]);
  assert.deepEqual(urls, ['https://x.com/1', 'https://y.com', 'https://z.com/p']);
});

test('stage prompts: delimiters, verbatim schema from spec 02, sources with indices, no full e-mail', () => {
  const ficha = { nome: 'Ana', empresa: 'ACME', cargo: 'ceo', rotuloCargo: 'CEO ou presidente', dominioEmail: 'acme.com.br', site: 'https://acme.com.br', mensagem: 'Oi', lang: 'pt-BR' };
  for (const e of ETAPAS) {
    const m = mensagemDaEtapa(e, ficha, { decisao: 'analisar' }, [{ url: 'https://acme.com.br/', titulo: 'Home', tipo: 'pagina', consultadoEm: 'x' }], { teste: 1 });
    assert.match(m, /<ficha>[\s\S]*<\/ficha>/);
    assert.match(m, /\[0\] pagina – Home – https:\/\/acme\.com\.br\//);
    assert.ok(m.includes(ESQUEMAS[e]));
    assert.doesNotMatch(m, /@/);
  }
});

test('cost: searches add US$ 0.01 each', () => {
  assert.equal(custoDe('claude-haiku-5-5', { input_tokens: 0, output_tokens: 0 }, 3).usdEstimado, 0.03);
});

test('search budget is per run, limited by the stages that run', () => {
  assert.equal(orcamentoBuscas(20, ETAPAS), 20); // full run: 22 possible, ceiling 20
  assert.equal(orcamentoBuscas(20, ['empresa_registro', 'empresa_pessoas']), 8);
  assert.equal(orcamentoBuscas(5, ['empresa_registro', 'empresa_pessoas']), 5);
  assert.equal(orcamentoBuscas(20, []), 0);
});
