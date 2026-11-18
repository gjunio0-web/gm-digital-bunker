// Editar análise (spec 05 §5.7; spec 01 §4.1 item 5): pure rules (sections, limit, counter, labels, next version) and the
// HTML of the editor. Run: node scripts/test-admin-editor.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'editor-'));
try {
  const entrada = join(dir, 'entrada.ts');
  writeFileSync(entrada, `export * from '${process.cwd()}/src/admin/leads/editor'; export { editorHTML, textoDoEditor, uiBarraVazia } from '${process.cwd()}/src/admin/leads/detalhe'; export { TEXTO_CONFLITO_EDITAR, tratarErroAcao } from '${process.cwd()}/src/admin/leads/acoes';`);
  const out = join(dir, 'e.mjs');
  await build({ entryPoints: [entrada], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  const M = await import(pathToFileURL(out).href);

  // Sections: s1 to s7 only (no s0, no s8)
  assert.deepEqual([...M.SECOES_EDITAVEIS], ['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
  assert.equal(M.rotuloSecao('s6'), 's6 · Enquadramento');
  assert.equal(M.rotuloSecao('s7'), 's7 · Preparação da primeira conversa');
  assert.equal(M.LIMITE_EDITOR, 20000);
  assert.equal(M.NOTA_S6, 'Editar o texto de s6 não altera os filtros de escopo e de porta provável nem a qualificação; a porta do administrador fica em "Decidir porta".');

  // Limit: empty (also only spaces) and above 20,000 block; 1 and exactly 20,000 pass
  const v = (t) => M.validaCorpo(t);
  assert.deepEqual(v(''), { n: 0, fora: 'vazio', ok: false });
  assert.equal(v('   \n ').fora, 'vazio');
  assert.equal(v('a').ok, true);
  assert.equal(v('a'.repeat(20000)).ok, true);
  assert.deepEqual(v('a'.repeat(20001)), { n: 20001, fora: 'acima', ok: false });
  // Counter wording (mock-up)
  assert.equal(M.contagemTxt(v('abc')), '3 de 20.000 caracteres');
  assert.equal(M.contagemTxt(v('')), '0 de 20.000 caracteres · o texto não pode ficar vazio');
  assert.equal(M.contagemTxt(v('a'.repeat(20001))), '20.001 de 20.000 caracteres · acima do limite');
  assert.equal(M.contagemTxt(v('a'.repeat(1234))), '1.234 de 20.000 caracteres');

  // Next version: highest number + 1, whatever the order
  assert.equal(M.proximaVersao([{ num: 1 }]), 2);
  assert.equal(M.proximaVersao([{ num: 3 }, { num: 1 }, { num: 2 }]), 4);
  assert.equal(M.proximaVersao([]), 1);
  // Text of a section
  assert.equal(M.corpoDaSecao({ secoes: { s2: { corpo: 'X' } } }, 's2'), 'X');
  assert.equal(M.corpoDaSecao({ secoes: { s2: { vazia: true, corpo: null } } }, 's2'), '');
  assert.equal(M.corpoDaSecao({}, 's2'), '');

  // HTML of the editor
  const analise = (id, num, s) => ({ id, num, d: { secoes: s } });
  const ficha = (estado, extra = {}) => ({ id: 'f', f: { estado, analiseAtual: 'v2', ...extra }, analises: [analise('v2', 2, { s1: { corpo: 'um <b>' }, s6: { corpo: 'seis' } }), analise('v1', 1, { s1: { corpo: 'antigo' } })], eventos: [], coleta: {} });
  const ui = (ed) => ({ ...M.uiBarraVazia(), ed });
  // Closed: nothing
  assert.equal(M.editorHTML(ficha('analise_pronta'), ui(null)), '');
  // Open on s1 of v2: option list s1..s7, text escaped, next version v3, base version kept apart from analiseAtual
  const h = M.editorHTML(ficha('analise_pronta'), ui({ base: 'v2', secao: 's1', textos: {}, conflito: false }));
  assert.equal((h.match(/<option /g) ?? []).length, 7);
  assert.ok(!/value="s0"|value="s8"/.test(h));
  assert.ok(h.includes('um &lt;b&gt;'));
  assert.ok(h.includes('Salvar como v3 (autor humano)'));
  assert.ok(h.includes('6 de 20.000 caracteres'));
  assert.ok(!h.includes('id="edNote"'), 'the s6 note only in s6');
  assert.ok(!h.includes('role="alert"'));
  // Text comes from the base version, not from the current one
  assert.equal(M.textoDoEditor(ficha('analise_pronta'), ui({ base: 'v1', secao: 's1', textos: {}, conflito: false })), 'antigo');
  // What was typed wins over the base text, per section
  assert.equal(M.textoDoEditor(ficha('analise_pronta'), ui({ base: 'v2', secao: 's1', textos: { s1: 'novo' }, conflito: false })), 'novo');
  assert.equal(M.textoDoEditor(ficha('analise_pronta'), ui({ base: 'v2', secao: 's6', textos: { s1: 'novo' }, conflito: false })), 'seis');
  // s6: the note; empty text: button disabled and reason; over the limit likewise
  const h6 = M.editorHTML(ficha('analise_pronta'), ui({ base: 'v2', secao: 's6', textos: {}, conflito: false }));
  assert.ok(h6.includes('id="edNote"') && h6.includes('a porta do administrador fica em &quot;Decidir porta&quot;'));
  const hv = M.editorHTML(ficha('analise_pronta'), ui({ base: 'v2', secao: 's1', textos: { s1: '' }, conflito: false }));
  assert.ok(/id="edSalvar" disabled/.test(hv) && hv.includes('o texto não pode ficar vazio'));
  const ha = M.editorHTML(ficha('analise_pronta'), ui({ base: 'v2', secao: 's1', textos: { s1: 'a'.repeat(20001) }, conflito: false }));
  assert.ok(/id="edSalvar" disabled/.test(ha) && ha.includes('acima do limite'));
  assert.ok(!/id="edSalvar" disabled/.test(M.editorHTML(ficha('analise_pronta'), ui({ base: 'v2', secao: 's1', textos: { s1: 'a'.repeat(20000) }, conflito: false }))));
  // While a call runs: button says Aguarde…, text read-only, selector and Cancelar off
  const he = M.editorHTML(ficha('analise_pronta'), { ...ui({ base: 'v2', secao: 's1', textos: {}, conflito: false }), aguardando: 'editar' });
  assert.ok(he.includes('Aguarde…') && he.includes('readonly') && /id="edSec" class="edsel" disabled/.test(he));
  // Conflict: the approved text, inside the editor, with the typed text still there
  const hc = M.editorHTML(ficha('analise_pronta'), ui({ base: 'v1', secao: 's1', textos: { s1: 'meu texto' }, conflito: true }));
  assert.ok(hc.includes('role="alert"') && hc.includes(M.TEXTO_CONFLITO_EDITAR) && hc.includes('meu texto'));
  assert.equal(M.TEXTO_CONFLITO_EDITAR, 'A análise mudou enquanto você editava. Seu texto foi mantido aqui; copie-o ou abra a versão atual.');
  // Editar is valid in Análise pronta, Com pendências and Aprovada; in the other states the editor is not drawn even if open
  const aberto = ui({ base: 'v2', secao: 's1', textos: {}, conflito: false });
  for (const e of ['analise_pronta', 'analise_com_pendencias', 'aprovada']) assert.ok(M.editorHTML(ficha(e), aberto).includes('id="editor"'), e);
  for (const e of ['respondida', 'arquivada', 'coletando', 'sintetizando', 'qualificada', 'resposta_breve']) assert.equal(M.editorHTML(ficha(e), aberto), '', e);
  // Error mapping: conflito on editar is the approved text; parametro_invalido names the field on screen
  assert.equal(M.tratarErroAcao({ details: { codigo: 'conflito' } }, 'editar').texto, M.TEXTO_CONFLITO_EDITAR);
  assert.equal(M.tratarErroAcao({ details: { codigo: 'parametro_invalido', campo: 'corpo' } }, 'editar').texto, 'O valor de Texto não foi aceito.');
  assert.equal(M.tratarErroAcao({ details: { codigo: 'parametro_invalido', campo: 'secao' } }, 'editar').texto, 'O valor de Seção não foi aceito.');
  assert.equal(M.tratarErroAcao({ details: { codigo: 'parametro_invalido', campo: 'baseadaEm' } }, 'editar').texto, 'O valor de Versão não foi aceito.');

  console.log('test-admin-editor: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
