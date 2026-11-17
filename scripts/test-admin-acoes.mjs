// Admin actions (spec 05 §5.7 and §5.7.1): bar by state, the eight error codes, silent success on repetition, "Aguarde…".
// Run: node scripts/test-admin-acoes.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'acoes-'));
try {
  const carrega = async (entrada, nome) => {
    const out = join(dir, nome);
    await build({ entryPoints: [entrada], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
    return import(pathToFileURL(out).href);
  };
  const A = await carrega('src/admin/leads/acoes.ts', 'acoes.mjs');
  const D = await carrega('src/admin/leads/detalhe.ts', 'detalhe.mjs');
  const { acoesDaBarra, acaoPrincipal, tratarErroAcao, ESTADO_PRODUZIDO, ACAO_DO_ITEM, TEXTO_ERRO, definirAvisoLista, consumirAvisoLista } = A;

  const C = { status: 'concluida' };
  const ETAPAS = ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'empresa_noticias', 'setor', 'mercado'];
  const todas = (e) => Object.fromEntries(ETAPAS.map((k) => [k, e]));
  const barra = (f, coleta = {}) => acoesDaBarra(f, coleta);
  const erro = { etapa: 'x' };

  // ---- Bar by state (table of spec 05 §5.7) ----
  assert.deepEqual(barra({ estado: 'recebida' }), ['arquivar']);
  assert.deepEqual(barra({ estado: 'recebida', erro }), ['reexecutar', 'arquivar']); // Recebida with erro now offers Reexecutar
  for (const e of ['coleta_minima', 'coletando', 'sintetizando']) {
    assert.deepEqual(barra({ estado: e }), [], `${e} sem erro: nenhuma ação`);
  }
  assert.deepEqual(barra({ estado: 'sintetizando', erro }), ['reexecutar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'coletando', erro }, { ...todas(C), setor: { status: 'falhou' } }), ['reexecutar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'coleta_minima', erro }, { empresa_digital: { status: 'falhou' }, empresa_registro: C }), ['reexecutar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'qualificada' }), ['arquivar']);
  assert.deepEqual(barra({ estado: 'qualificada', erro: { etapa: 'graduar' } }), ['reexecutar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'qualificada', retencao: { motivo: 'teto_diario' } }), ['mandar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'qualificada', retencao: {}, erro: { etapa: 'graduar' } }), ['mandar', 'reexecutar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'descartada' }), ['arquivar']);
  assert.deepEqual(barra({ estado: 'resposta_breve' }), ['mandar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'coletada' }), ['arquivar']);
  assert.deepEqual(barra({ estado: 'coletada', erro }), ['reexecutar', 'arquivar']);
  for (const e of ['analise_pronta', 'analise_com_pendencias']) assert.deepEqual(barra({ estado: e }), ['aprovar', 'editar', 'porta', 'reexecutar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'aprovada' }), ['resposta', 'editar', 'porta', 'reexecutar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'respondida' }), ['porta', 'arquivar']);
  assert.deepEqual(barra({ estado: 'arquivada' }), []);
  assert.deepEqual(barra({ estado: 'arquivada', erro }), []);
  assert.deepEqual(barra({ estado: 'xyz' }), []);
  assert.deepEqual(barra({}), []);

  // Reexecutar only when the selector has an option (alvosReexecutar is the single source of the rule)
  assert.deepEqual(barra({ estado: 'qualificada', erro: { etapa: 'coleta_minima' } }), ['arquivar'], 'Qualificada com erro que não é graduar: sem Reexecutar');
  assert.deepEqual(barra({ estado: 'coleta_minima', erro }, todas(C)), ['reexecutar', 'arquivar'], 'duas etapas mínimas usáveis: Qualificação');
  assert.deepEqual(barra({ estado: 'coletando', erro }, { ...todas({ status: 'executando' }) }), ['reexecutar', 'arquivar']);
  assert.deepEqual(barra({ estado: 'coleta_minima', erro }, { empresa_digital: { status: 'executando' }, empresa_registro: { status: 'executando' } }), ['reexecutar', 'arquivar']);

  // Main action: the only cobalt button
  assert.equal(acaoPrincipal('analise_pronta'), 'aprovar');
  assert.equal(acaoPrincipal('analise_com_pendencias'), 'aprovar');
  assert.equal(acaoPrincipal('aprovada'), 'resposta');
  for (const e of ['recebida', 'respondida', 'coletando', 'resposta_breve', 'arquivada', 'qualificada']) assert.equal(acaoPrincipal(e), null, e);

  // ---- The eight codes (texts of spec 05 §5.7.1) ----
  const erroFn = (codigo, extra = {}) => ({ code: 'functions/failed-precondition', message: 'MENSAGEM CRUA DA FUNCAO', details: { codigo, ...extra } });
  const txt = (codigo, extra, acao = 'aprovar') => tratarErroAcao(erroFn(codigo, extra), acao);
  assert.deepEqual(txt('nao_autenticado'), { tipo: 'erro', texto: 'Sua sessão expirou. Entre de novo.', voltarLista: false });
  assert.equal(txt('sem_permissao').texto, 'Esta conta não tem permissão para esta ação.');
  assert.deepEqual(txt('ficha_inexistente'), { tipo: 'erro', texto: 'Esta ficha não existe mais.', voltarLista: true });
  assert.equal(txt('acao_invalida_no_estado', { estadoAtual: 'coletando' }).texto, 'Esta ação não vale mais para a ficha, que agora está em Coletando.');
  assert.equal(txt('acao_invalida_no_estado', { estadoAtual: 'analise_com_pendencias' }).texto, 'Esta ação não vale mais para a ficha, que agora está em Com pendências.');
  assert.equal(txt('acao_invalida_no_estado', {}).texto, 'Esta ação não vale mais para a ficha.');
  assert.equal(txt('acao_invalida_no_estado', { estadoAtual: 'inventado' }).texto, 'Esta ação não vale mais para a ficha.');
  assert.equal(txt('ficha_em_processamento').texto, 'A ficha está sendo processada. Tente de novo quando ela terminar.');
  assert.equal(txt('conflito').texto, 'A ficha mudou durante a ação. Confira o estado e tente de novo.');
  assert.equal(txt('conflito', {}, 'editar').texto, 'A análise mudou enquanto você editava. Seu texto foi mantido aqui; copie-o ou abra a versão atual.');
  assert.equal(txt('conflito', {}, 'reexecutar').texto, TEXTO_ERRO.conflito);
  assert.equal(txt('interno').texto, 'Não foi possível concluir a ação. Tente de novo; se o erro se repetir, avise quem administra o sistema.');
  // parametro_invalido: field by the name on screen
  const campos = { alvo: 'Reexecutar', porta: 'Porta', secao: 'Seção', corpo: 'Texto', baseadaEm: 'Versão', expurgoImediato: 'Apagar agora' };
  for (const [k, v] of Object.entries(campos)) assert.equal(txt('parametro_invalido', { campo: k }).texto, `O valor de ${v} não foi aceito.`);
  assert.equal(txt('parametro_invalido', {}).texto, 'O valor enviado não foi aceito.');
  assert.equal(txt('parametro_invalido', { campo: 'campo_novo' }).texto, 'O valor enviado não foi aceito.');
  // The raw message never reaches the screen; unknown code, no details and network failures read as `interno`
  const interno = TEXTO_ERRO.interno;
  for (const e of [erroFn('codigo_novo'), { code: 'functions/unavailable', message: 'Failed to fetch' }, new Error('boom'), null, undefined, 'texto', { details: 'x' }, { details: { codigo: 7 } }]) {
    const r = tratarErroAcao(e, 'aprovar');
    assert.equal(r.tipo, 'erro'); assert.equal(r.texto, interno); assert.equal(r.voltarLista, false);
  }
  for (const c of ['nao_autenticado', 'sem_permissao', 'ficha_inexistente', 'acao_invalida_no_estado', 'parametro_invalido', 'ficha_em_processamento', 'conflito', 'interno']) {
    assert.ok(!txt(c, { estadoAtual: 'coletando', campo: 'alvo' }).texto.includes('CRUA'), c);
  }

  // ---- Silent success on repetition ----
  assert.deepEqual(ESTADO_PRODUZIDO, { aprovar: 'aprovada', respostaEnviada: 'respondida', mandarParaAnalise: 'coletando', arquivar: 'arquivada' });
  for (const [acao, estado] of Object.entries(ESTADO_PRODUZIDO)) {
    const r = tratarErroAcao(erroFn('acao_invalida_no_estado', { estadoAtual: estado }), acao);
    assert.equal(r.tipo, 'sucesso', acao); assert.equal(r.texto, '');
    // another state is still an error
    assert.equal(tratarErroAcao(erroFn('acao_invalida_no_estado', { estadoAtual: 'respondida' === estado ? 'aprovada' : 'respondida' }), acao).tipo, 'erro', acao);
  }
  // Actions without a produced state never read as silent success
  for (const acao of ['portaDecidida', 'reexecutar', 'editar']) assert.equal(tratarErroAcao(erroFn('acao_invalida_no_estado', { estadoAtual: 'aprovada' }), acao).tipo, 'erro', acao);
  assert.equal(tratarErroAcao(erroFn('acao_invalida_no_estado', { estadoAtual: 'aprovada' }), 'respostaEnviada').tipo, 'erro');

  // Names of the actions as the function receives them
  assert.deepEqual(ACAO_DO_ITEM, { mandar: 'mandarParaAnalise', aprovar: 'aprovar', resposta: 'respostaEnviada', editar: 'editar', porta: 'portaDecidida', reexecutar: 'reexecutar', arquivar: 'arquivar' });

  // One-shot notice for the next list
  assert.equal(consumirAvisoLista(), '');
  definirAvisoLista('Esta ficha não existe mais.');
  assert.equal(consumirAvisoLista(), 'Esta ficha não existe mais.');
  assert.equal(consumirAvisoLista(), '');

  // ---- HTML of the bar ----
  const { barraHTML, uiBarraVazia, corpoHTML } = D;
  const ficha = (f, coleta = {}) => ({ id: 'x', f, analises: [], eventos: [], coleta });
  const h1 = barraHTML(ficha({ estado: 'analise_pronta' }), uiBarraVazia());
  assert.ok(h1.includes('class="actbar" role="group" aria-label="Ações da ficha"'));
  assert.equal((h1.match(/class="btn primary"/g) ?? []).length, 1, 'um único botão cobalto');
  assert.ok(h1.includes('class="btn primary" type="button" data-act="aprovar"'));
  assert.ok(!h1.includes('role="alert"'));
  for (const rot of ['Aprovar análise', 'Editar análise', 'Decidir porta', 'Reexecutar', 'Arquivar']) assert.ok(h1.includes(`>${rot}<`), rot);
  assert.equal((barraHTML(ficha({ estado: 'recebida' }), uiBarraVazia()).match(/class="btn primary"/g) ?? []).length, 0);
  // Aguarde…: the running button says so and the whole bar is disabled
  const esp = barraHTML(ficha({ estado: 'analise_pronta' }), { ...uiBarraVazia(), aguardando: 'aprovar' });
  assert.ok(esp.includes('data-act="aprovar" disabled>Aguarde…<'));
  assert.equal((esp.match(/ disabled>/g) ?? []).length, 5);
  assert.ok(!barraHTML(ficha({ estado: 'analise_pronta' }), uiBarraVazia()).includes('disabled'));
  // Alert next to the bar, escaped, with a way to close it
  const al = barraHTML(ficha({ estado: 'aprovada' }), { ...uiBarraVazia(), erro: 'Texto <b>x</b>' });
  assert.ok(al.includes('<div class="acaoerr" role="alert"><span>Texto &lt;b&gt;x&lt;/b&gt;</span>'));
  assert.ok(al.includes('data-act="fechar-aviso">Fechar aviso<'));
  // No action: states that say why, and the alert still shows
  assert.ok(barraHTML(ficha({ estado: 'coletando' }), uiBarraVazia()).includes('A ficha está sendo processada: nenhuma ação disponível.'));
  assert.ok(barraHTML(ficha({ estado: 'arquivada' }), uiBarraVazia()).includes('Ficha arquivada: nenhuma ação disponível.'));
  assert.equal(barraHTML(ficha({ estado: 'xyz' }), uiBarraVazia()), '');
  assert.ok(barraHTML(ficha({ estado: 'arquivada' }), { ...uiBarraVazia(), erro: 'E' }).includes('role="alert"'));
  assert.ok(!barraHTML(ficha({ estado: 'coletando' }), uiBarraVazia()).includes('actbar'));
  // The bar comes before the version selector and only when the page asks for it
  const hoje = new Date(Date.UTC(2026, 10, 17, 16, 0));
  const d = { id: 'x', f: { estado: 'aprovada', analiseAtual: 'v1', nome: 'N' }, analises: [{ id: 'v1', num: 1, d: { autor: { tipo: 'ia' }, secoes: {} } }], eventos: [], coleta: {} };
  const com = corpoHTML(d, null, hoje, uiBarraVazia());
  assert.ok(com.indexOf('class="actbar"') >= 0 && com.indexOf('class="actbar"') < com.indexOf('class="ver"'));
  assert.ok(!corpoHTML(d, null, hoje).includes('actbar'));

  console.log('test-admin-acoes: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
