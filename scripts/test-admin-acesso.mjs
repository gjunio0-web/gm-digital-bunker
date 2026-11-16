// Checks the admin shell's role check (src/admin/acesso.ts): a failed read must never be reported as "no access".
// Run: node scripts/test-admin-acesso.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'acesso-'));
try {
  const out = join(dir, 'acesso.mjs');
  await build({ entryPoints: ['src/admin/acesso.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  const { verificarAcesso } = await import(pathToFileURL(out).href);

  let falhas = 0;
  // Runs verificarAcesso with a scripted sequence of outcomes: a string or null is a role read, an Error rejects.
  const caso = async (nome, respostas, esperado, pausasEsperadas = []) => {
    let leituras = 0;
    const pausas = [];
    const lerPapel = async () => {
      const r = respostas[Math.min(leituras++, respostas.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    };
    const resultado = await verificarAcesso(lerPapel, undefined, async (ms) => { pausas.push(ms); });
    const ok = resultado === esperado && JSON.stringify(pausas) === JSON.stringify(pausasEsperadas);
    if (!ok) falhas++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${nome}: ${resultado}, ${leituras} leitura(s), pausas ${JSON.stringify(pausas)}`);
  };
  const erro = (code) => Object.assign(new Error(code ?? 'falha'), code ? { code } : {});

  await caso('papel admin', ['admin'], 'ok');
  await caso('papel leitor', ['leitor'], 'ok');
  await caso('documento ausente (null)', [null], 'sem-acesso');
  await caso('papel desconhecido', ['outro'], 'sem-acesso');
  await caso('permission-denied não repete', [erro('permission-denied')], 'sem-acesso');
  await caso('falha transitória e depois admin', [erro('unavailable'), 'admin'], 'ok', [1000]);
  await caso('duas falhas e depois leitor', [erro('unavailable'), erro('deadline-exceeded'), 'leitor'], 'ok', [1000, 3000]);
  await caso('falha persistente não vira "sem acesso"', [erro('unavailable')], 'indisponivel', [1000, 3000]);
  await caso('erro sem código também é indisponível', [erro()], 'indisponivel', [1000, 3000]);
  await caso('falha e depois documento ausente', [erro('unavailable'), null], 'sem-acesso', [1000]);

  if (falhas) { console.error(`${falhas} caso(s) falharam`); process.exitCode = 1; } else console.log('Todos os casos passaram.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
