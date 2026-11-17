// Display of the ficha detail that depends on the stored data (spec 05 §5.2 and §5.4): the pipeline error chip and block
// for the four interruptions. Run: node scripts/test-admin-exibicao.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'exibicao-'));
try {
  const bundle = async (entry, name) => {
    const out = join(dir, name);
    await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
    return import(pathToFileURL(out).href);
  };
  const { erroHTML } = await bundle('src/admin/leads/detalhe.ts', 'detalhe.mjs');
  const { erroTxt } = await bundle('src/admin/leads/regras.ts', 'regras.mjs');

  // 2026-11-05 11:55 UTC = 08:55 in São Paulo
  const parada = { tipo: 'parada', em: new Date(Date.UTC(2026, 10, 5, 11, 55)), detalhe: { minutos: 30 } };
  const erro = (etapa) => erroHTML({ f: { erro: { etapa } }, eventos: [parada], analises: [], coleta: {} });

  // Chips
  assert.equal(erroTxt({ etapa: 'interrupcao:coletada' }), 'Erro na síntese · não iniciada');
  assert.equal(erroTxt({ etapa: 'interrupcao:coletando' }), 'Erro na coleta · interrompida');
  assert.equal(erroTxt({ etapa: 'interrupcao:coleta_minima' }), 'Erro na coleta mínima · interrompida');
  assert.equal(erroTxt({ etapa: 'interrupcao:sintetizando' }), 'Erro na síntese · interrompida');

  // Blocks: the new case and the three old ones, unchanged
  const quando = 'em 5/nov/2026 às 08:55';
  const bloco = (chip, titulo, estado, falta, uso) =>
    `<div class="panel"><h3>Erro no pipeline</h3><ul class="pend"><li class="esc"><p class="pt">${chip}</p>` +
    `<p class="tr"><strong>${titulo}</strong> A ficha ficou em ${estado} por mais de 30 minutos ${falta}, e o pipeline a marcou como parada ${quando}. ${uso}</p></li></ul></div>`;
  assert.equal(erro('interrupcao:coletada'),
    bloco('Erro na síntese · não iniciada', 'Síntese não iniciada.', 'Coletada', 'sem que a síntese começasse', 'Use &quot;Reexecutar › Síntese&quot; para gerar a análise.'));
  assert.equal(erro('interrupcao:coletando'),
    bloco('Erro na coleta · interrompida', 'Coleta interrompida.', 'Coletando', 'sem concluir', 'Use &quot;Reexecutar&quot; para retomar as etapas que não terminaram.'));
  assert.equal(erro('interrupcao:coleta_minima'),
    bloco('Erro na coleta mínima · interrompida', 'Coleta mínima interrompida.', 'Coleta mínima', 'sem concluir', 'Use &quot;Reexecutar&quot; para retomar as etapas da coleta mínima que não terminaram.'));
  assert.equal(erro('interrupcao:sintetizando'),
    bloco('Erro na síntese · interrompida', 'Síntese interrompida.', 'Sintetizando', 'sem concluir', 'Use &quot;Reexecutar › Síntese&quot; para gerar a análise de novo.'));

  // B (spec 05 §5.2; Gon, 17/11/2026): chip texts of qualificar/graduar, coleta_minima, the recepção interruption and coletarMinima
  assert.equal(erroTxt({ etapa: 'qualificar' }), 'Erro na qualificação');
  assert.equal(erroTxt({ etapa: 'graduar' }), 'Erro na qualificação');
  assert.equal(erroTxt({ etapa: 'coleta_minima' }), 'Erro na coleta mínima');
  assert.equal(erroTxt({ etapa: 'coletarMinima' }), 'Erro na coleta mínima'); // kept for a ficha stored with that value
  assert.equal(erroTxt({ etapa: 'interrupcao:recebida' }), 'Erro na recepção · interrompida');
  assert.equal(erroTxt({ etapa: 'interrupcao:coleta_minima' }), 'Erro na coleta mínima · interrompida'); // the suffix stays only on the interruption
  assert.equal(erroTxt({ etapa: 'verificar.email' }), 'Erro na verificação');
  assert.equal(erroTxt({ etapa: 'empresa_futura' }), 'Erro no pipeline');
  assert.equal(erroTxt({ etapa: '' }), 'Erro no pipeline');
  assert.equal(erro('interrupcao:recebida'),
    bloco('Erro na recepção · interrompida', 'Recepção interrompida.', 'Recebida', 'sem que a coleta mínima começasse', 'Use &quot;Reexecutar › Coleta mínima&quot; para iniciar a coleta.'));

  // C: erro of the recepção e-mails (old fichas): chip "Erro no pipeline", the message stays, the "Reexecutar" sentence goes
  const FRASE = 'Use "Reexecutar" para repetir a etapa; a análise segue a partir dela.'; // as the code writes it (not escaped)
  const comMsg = (etapa, mensagem) => erroHTML({ f: { erro: { etapa, mensagem } }, eventos: [], analises: [], coleta: {} });
  for (const etapa of ['email_confirmacao', 'email_aviso']) {
    assert.equal(erroTxt({ etapa }), 'Erro no pipeline');
    assert.equal(comMsg(etapa, 'smtp fora do ar'),
      '<div class="panel"><h3>Erro no pipeline</h3><ul class="pend"><li class="esc"><p class="pt">Erro no pipeline</p><p class="tr">smtp fora do ar</p></li></ul></div>');
    assert.ok(!comMsg(etapa, 'x').includes('Reexecutar'));
  }
  // The other erros keep the sentence
  for (const etapa of ['qualificar', 'graduar', 'coleta_minima', 'coletar', 'sintetizar', 'verificar.email', 'empresa_futura']) {
    assert.ok(comMsg(etapa, 'falhou').includes(`<p class="cs">${FRASE}</p>`), etapa);
  }
  assert.ok(comMsg('qualificar', 'falhou').includes('<p class="tr">falhou</p>'));

  // Without the parada event the block still renders
  assert.ok(erroHTML({ f: { erro: { etapa: 'interrupcao:coletada' } }, eventos: [], analises: [], coleta: {} }).includes('mais de ? minutos sem que a síntese começasse'));
  // No erro: nothing
  assert.equal(erroHTML({ f: {}, eventos: [], analises: [], coleta: {} }), '');

  // ---- Previous collection data (spec 05 §5.4) ----
  const { preservadoHTML, pessoasHTML, fichaRecebidaHTML, etapaUsavel } = await bundle('src/admin/leads/detalhe.ts', 'detalhe2.mjs');
  const dt = (...a) => new Date(Date.UTC(...a));
  const ficha = (coleta) => ({ id: 'x', f: { original: { cargo: 'diretor' } }, eventos: [], analises: [], coleta });
  const NOTA = '<p class="help" style="margin-top:0">Estes dados vêm de uma consulta anterior; a nova consulta falhou ou não foi feita.</p>';
  const painel = (linhas) => `<div class="panel"><h3>Dado da coleta anterior</h3>${NOTA}<dl class="kv">${linhas}</dl></div>`;

  // Without preservado: no block
  assert.equal(preservadoHTML(ficha({ empresa_digital: { status: 'concluida' }, empresa_pessoas: { status: 'concluida' } })), '');
  assert.equal(preservadoHTML(ficha({})), '');

  // Blocks (Apollo) and whole stage, in stage order; dates in São Paulo time (09:12 local = 12:12 UTC)
  const digital = { status: 'concluida', preservado: { blocos: ['apollo'], desde: dt(2026, 9, 30, 15), falhouEm: dt(2026, 10, 5, 12, 12), falha: 'Apollo: resposta HTTP 503' } };
  const pessoas = { status: 'falhou', conteudo: { signatario: { cargoFontes: [{ fonte: 'hunter', cargo: 'Logistics Director', senioridade: 'director', empresaAtual: 'Porto Seco Armazéns' }] } },
    preservado: { blocos: ['etapa'], desde: dt(2026, 9, 30, 15), falhouEm: dt(2026, 10, 5, 12, 14), falha: 'resposta HTTP 500 da base profissional (Hunter)' } };
  assert.equal(preservadoHTML(ficha({ empresa_pessoas: pessoas, empresa_digital: digital })), painel(
    '<dt>Presença digital</dt><dd><strong>Apollo</strong> · anterior, de 30/out/2026<br><span class="cs">Apollo: resposta HTTP 503 · falha em 5/nov/2026 às 09:12</span></dd>' +
    '<dt>Pessoas</dt><dd><strong>Etapa inteira</strong> · anterior, de 30/out/2026<br><span class="cs">resposta HTTP 500 da base profissional (Hunter) · falha em 5/nov/2026 às 09:14</span></dd>'));

  // Two blocks in one stage; text of falha is escaped and shown as recorded
  const dois = { status: 'concluida', preservado: { blocos: ['apollo', 'instagram'], desde: dt(2026, 9, 30, 15), falhouEm: dt(2026, 10, 5, 12, 12), falha: 'Apollo: <b>x</b>' } };
  assert.ok(preservadoHTML(ficha({ empresa_digital: dois })).includes('<strong>Apollo e Instagram</strong> · anterior, de 30/out/2026<br><span class="cs">Apollo: &lt;b&gt;x&lt;/b&gt; · falha em'));

  // Odd data never throws: no blocos, no dates, ISO text dates
  assert.ok(preservadoHTML(ficha({ setor: { status: 'concluida', preservado: {} } })).includes('<dt>Setor</dt><dd>anterior, de data desconhecida</dd>'));
  assert.ok(preservadoHTML(ficha({ setor: { status: 'concluida', preservado: { blocos: ['etapa'], desde: '2026-10-30T15:00:00.000Z', falhouEm: 'x' } } })).includes('Etapa inteira</strong> · anterior, de 30/out/2026</dd>'));
  assert.equal(preservadoHTML(ficha({ setor: { status: 'concluida', preservado: null } })), '');

  // Usable stage
  assert.equal(etapaUsavel({ status: 'concluida' }), true);
  assert.equal(etapaUsavel({ status: 'falhou', preservado: { blocos: ['etapa'] } }), true);
  assert.equal(etapaUsavel({ status: 'falhou', preservado: { blocos: ['apollo'] } }), false);
  assert.equal(etapaUsavel({ status: 'falhou' }), false);
  assert.equal(etapaUsavel({ status: 'pendente', preservado: { blocos: ['etapa'] }, conteudo: {} }), false);
  assert.equal(etapaUsavel({ status: 'executando', preservado: { blocos: ['etapa'] } }), false);
  assert.equal(etapaUsavel(undefined), false);

  // Pessoas: whole-stage preserved shows the old content with the "Dado anterior" note
  const ptxt = (e) => pessoasHTML(ficha({ empresa_pessoas: e }));
  assert.ok(ptxt(pessoas).includes('<td>Hunter</td><td>Logistics Director</td><td>director · Porto Seco Armazéns</td>'));
  assert.ok(ptxt(pessoas).includes('Dado anterior: a etapa Pessoas falhou nesta execução e o conteúdo da execução de 30/out/2026 foi mantido. Trajetória profissional não coletada.'));
  // concluida without preservado: unchanged note; pendente/executando with old content: no content
  assert.ok(ptxt({ status: 'concluida', conteudo: pessoas.conteudo }).includes('Sem divergência entre as fontes. Trajetória profissional não coletada.'));
  for (const status of ['pendente', 'executando']) {
    const h = ptxt({ ...pessoas, status });
    assert.ok(!h.includes('Hunter') && h.includes('A etapa Pessoas ainda não rodou'));
  }
  // falhou without the whole stage kept: its own note, and only the form row (spec 05 §5.4)
  const FALHOU = 'A etapa Pessoas falhou e não há dado anterior: só o cargo do formulário. Trajetória profissional não coletada.';
  const AINDA = 'A etapa Pessoas ainda não rodou: só o cargo do formulário. Trajetória profissional não coletada.';
  for (const e of [{ status: 'falhou' }, { status: 'falhou', conteudo: pessoas.conteudo }, { ...pessoas, preservado: { blocos: ['apollo'] } }, { ...pessoas, preservado: null }]) {
    const h = ptxt(e);
    assert.ok(h.includes(FALHOU) && !h.includes('Hunter') && !h.includes(AINDA), JSON.stringify(e).slice(0, 60));
    assert.equal((h.match(/<tr><td>/g) ?? []).length, 1);
  }
  // never ran, absent document, not applicable or unknown status: the current note
  for (const e of [{ status: 'pendente' }, { status: 'executando' }, undefined, { status: 'nao_aplicavel' }, { status: 'estranho' }, {}]) {
    assert.ok(ptxt(e).includes(AINDA) && !ptxt(e).includes(FALHOU), JSON.stringify(e));
  }
  // falhou with the whole stage kept: previous content, note unchanged
  assert.ok(ptxt(pessoas).includes('Dado anterior:') && !ptxt(pessoas).includes(FALHOU));

  // Ficha recebida: CNPJ read only from a usable Registro stage
  const reg = { conteudo: { escolhido: { cnpj: '12345678000190' }, confirmado: true, origemCnpj: 'site' } };
  const cnpj = (e) => fichaRecebidaHTML({ ...ficha({ empresa_registro: e }), f: { original: {}, origem: {} } });
  assert.ok(cnpj({ status: 'concluida', ...reg }).includes('12.345.678/0001-90'));
  assert.ok(cnpj({ status: 'falhou', ...reg, preservado: { blocos: ['etapa'] } }).includes('12.345.678/0001-90'));
  for (const status of ['pendente', 'executando']) assert.ok(cnpj({ status, ...reg }).includes('a confirmar na primeira conversa'));

  console.log('test-admin-exibicao: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
