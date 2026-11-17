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

  // Without the parada event the block still renders
  assert.ok(erroHTML({ f: { erro: { etapa: 'interrupcao:coletada' } }, eventos: [], analises: [], coleta: {} }).includes('mais de ? minutos sem que a síntese começasse'));
  // No erro: nothing
  assert.equal(erroHTML({ f: {}, eventos: [], analises: [], coleta: {} }), '');
  console.log('test-admin-exibicao: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
