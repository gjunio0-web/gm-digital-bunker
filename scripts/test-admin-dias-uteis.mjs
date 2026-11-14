// Checks that the admin hub's business-day rules (src/admin/leads/diasUteis.ts) match the pipeline's
// (functions/src/graduacao.ts) for every day of 2026 to 2030, and that diasUteisRestantes counts the
// deadline the way the pipeline sets it (prazoEmDiasUteis). Run: node scripts/test-admin-dias-uteis.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'dias-uteis-'));
try {
  const carregar = async (entrada, nome) => {
    const out = join(dir, nome + '.mjs');
    await build({ entryPoints: [entrada], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
    return import(pathToFileURL(out).href);
  };
  const hub = await carregar('src/admin/leads/diasUteis.ts', 'hub');
  const pipe = await carregar('functions/src/graduacao.ts', 'pipeline');

  let dias = 0, erros = 0;
  for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2030, 11, 31); t += 86_400_000) {
    const d = new Date(t);
    if (hub.diaUtil(d) !== pipe.diaUtil(d)) { erros++; console.error('diaUtil differs on', d.toISOString().slice(0, 10)); }
    dias++;
  }
  // A deadline of n business days from a start at 10:00 in São Paulo leaves n business days on the start day.
  for (let t = Date.UTC(2026, 0, 1, 13); t <= Date.UTC(2027, 11, 31, 13); t += 86_400_000) {
    for (const n of [2, 3, 4, 5]) {
      const prazo = pipe.prazoEmDiasUteis(new Date(t), n);
      const r = hub.diasUteisRestantes(new Date(t), prazo);
      if (r !== n) { erros++; console.error(`restantes ${r} != ${n} from`, new Date(t).toISOString()); }
    }
  }
  // Overdue text (spec 05 §5.2, decision of Gon 2026-11-14): deadline Friday 13/11/2026
  const regras = await carregar('src/admin/leads/regras.ts', 'regras');
  const prazo = new Date('2026-11-13T23:59:59-03:00');
  for (const [hoje, esperado] of [['2026-11-13T10:00:00-03:00', '0 d.ú.'], ['2026-11-12T10:00:00-03:00', '1 d.ú.'],
    ['2026-11-14T10:00:00-03:00', 'vencido'], ['2026-11-15T10:00:00-03:00', 'vencido'], ['2026-11-16T10:00:00-03:00', 'vencido há 1 d.ú.'],
    ['2026-11-18T10:00:00-03:00', 'vencido há 3 d.ú.']]) {
    const r = regras.restanteTxt(new Date(hoje), prazo);
    if (r !== esperado) { erros++; console.error(`restanteTxt ${hoje}: "${r}" != "${esperado}"`); }
  }
  if (erros) { console.error(`FAIL: ${erros} difference(s)`); process.exit(1); }
  console.log(`ok: ${dias} days compared; remaining business days match the pipeline deadlines for 2026–2027`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
