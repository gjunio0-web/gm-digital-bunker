// Business days for the admin hub (spec 04, section 2.4). Copy of the rules in functions/src/graduacao.ts
// (pascoa, feriados, diaUtil), which the hub cannot import; scripts/test-admin-dias-uteis.mjs compares the two
// day by day, so a change on one side without the other fails the test.
// Monday to Friday, without the fixed national holidays and Carnival (Monday and Tuesday), Good Friday and
// Corpus Christi. Dates are São Paulo calendar days (UTC-3, no daylight saving time since 2019).

const DIA_MS = 86_400_000;
const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const cache = new Map<number, Set<string>>();
export function feriados(ano: number): Set<string> {
  let s = cache.get(ano);
  if (!s) {
    const p = pascoa(ano).getTime();
    const moveis = [-48, -47, -2, 60].map((n) => iso(new Date(p + n * DIA_MS)));
    s = new Set([...FIXOS.map((md) => `${ano}-${md}`), ...moveis]);
    cache.set(ano, s);
  }
  return s;
}

/** d: UTC midnight of a São Paulo calendar day. */
export function diaUtil(d: Date): boolean {
  const s = d.getUTCDay();
  return s !== 0 && s !== 6 && !feriados(d.getUTCFullYear()).has(iso(d));
}

/** UTC midnight of the São Paulo calendar day of an instant. */
export function diaSP(instante: Date): Date {
  const local = new Date(instante.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/**
 * Business days left until the deadline (spec 05, §5.2, "n d.ú."): the business days after today up to and
 * including the deadline day. Today does not count, as the start day does not count in the deadline itself.
 * 0 on the deadline day; negative once it has passed (business days elapsed since).
 */
export function diasUteisRestantes(hoje: Date, prazo: Date): number {
  const a = diaSP(hoje).getTime(), b = diaSP(prazo).getTime();
  if (a === b) return 0;
  const passo = a < b ? DIA_MS : -DIA_MS;
  let n = 0;
  for (let t = a + passo; passo > 0 ? t <= b : t >= b; t += passo) {
    if (diaUtil(new Date(passo > 0 ? t : t + DIA_MS))) n++;
  }
  return passo > 0 ? n : -n;
}
